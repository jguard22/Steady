// Device adapter: BrilliantWear SDK → engine frames.
//
// Inside the BrilliantWear phone app, Steady runs as one of several apps
// sharing the same wearables. The SDK connects to the phone app on its own;
// Steady only states the sensor rates it would like (the phone app serves
// every app at its own rate and asks the person for permission the first
// time). Steady never connects, disconnects or reconfigures a device for
// anyone else. In a desktop browser with Web Bluetooth, the person picks
// their insoles directly.

export const SDK_URL =
  "https://cdn.jsdelivr.net/gh/brilliantsole/BrilliantWear-JavaScript-SDK@7b23d5f75b7a3f98e67ef2d548a89d98816dccac/build/brilliantwear.module.min.js";

export const RATES = { pressure: 20, linearAcceleration: 20, gameRotation: 20, stepDetector: 20 };

const G = 9.80665;

/** Rotate vector v by unit quaternion q (x,y,z,w). */
export function rotate(q, v) {
  const { x, y, z, w } = q;
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (y * v.z - z * v.y);
  const ty = 2 * (z * v.x - x * v.z);
  const tz = 2 * (x * v.y - y * v.x);
  return {
    x: v.x + w * tx + (y * tz - z * ty),
    y: v.y + w * ty + (z * tx - x * tz),
    z: v.z + w * tz + (x * ty - y * tx),
  };
}

/** Sum each sensor's load into heel/mid/fore/toe by its position along the foot. */
export function regionsFromSensors(sensors) {
  const r = { heel: 0, mid: 0, fore: 0, toe: 0 };
  for (const s of sensors ?? []) {
    const y = s.position?.y;
    const v = s.scaledValue ?? s.rawValue ?? 0;
    if (y == null) continue;
    if (y < 0.3) r.heel += v;
    else if (y < 0.55) r.mid += v;
    else if (y < 0.85) r.fore += v;
    else r.toe += v;
  }
  return r;
}

/**
 * @param {{onPressure:Function,onMotion:Function,onStep:Function,onDevices:Function,onStatus:Function}} h
 */
export async function connectSdk(h) {
  h.onStatus?.("loading");
  let BW;
  try {
    BW = await import(/* @vite-ignore */ SDK_URL);
  } catch (e) {
    h.onStatus?.("unavailable", e);
    return null;
  }
  const pair = BW.DevicePair?.insoles;
  const quat = { left: null, right: null };
  const devices = new Map();

  const configure = (device) => {
    try {
      const p = device.setSensorConfiguration?.(RATES);
      p?.catch?.(() => h.onStatus?.("permission"));
    } catch {
      h.onStatus?.("permission");
    }
  };

  const publish = () => {
    const list = [...(BW.DeviceManager?.connectedDevices ?? [])].map((d) => ({
      id: d.bluetoothId ?? d.id ?? d.name, name: d.name, type: d.type, side: d.side ?? (String(d.type).toLowerCase().includes("left") ? "left" : String(d.type).toLowerCase().includes("right") ? "right" : null),
      battery: d.batteryLevel ?? null, isInsole: /insole/i.test(String(d.type)),
    }));
    h.onDevices?.(list);
    const insoles = list.filter((d) => d.isInsole);
    h.onStatus?.(insoles.length >= 2 ? "live" : insoles.length === 1 ? "partial" : "waiting");
  };

  BW.DeviceManager?.addEventListener?.("connectedDevices", publish);
  BW.DeviceManager?.addEventListener?.("deviceIsConnected", (e) => {
    const d = e.message?.device;
    if (d?.isConnected) {
      devices.set(d.bluetoothId ?? d.name, d);
      d.addEventListener?.("batteryLevel", publish);
    }
    publish();
  });

  if (pair) {
    pair.addEventListener("deviceIsConnected", (e) => {
      const { device, isConnected } = e.message ?? {};
      if (isConnected && device) configure(device);
      publish();
    });
    pair.addEventListener("devicePressure", (e) => {
      const { side, pressure, timestamp } = e.message ?? {};
      if (!pressure || !side) return;
      h.onPressure({
        t: timestamp ?? Date.now(),
        side,
        load: pressure.scaledSum ?? 0,
        cop: pressure.center ? { x: pressure.center.x, y: pressure.center.y } : null,
        regions: regionsFromSensors(pressure.sensors),
        sensors: (pressure.sensors ?? []).map((s) => ({ x: s.position?.x, y: s.position?.y, v: s.normalizedValue ?? 0 })),
      });
    });
    pair.addEventListener("deviceGameRotation", (e) => {
      const { side, gameRotation, gameRotationEuler, timestamp } = e.message ?? {};
      if (!side) return;
      quat[side] = gameRotation ?? null;
      h.onMotion({ t: timestamp ?? Date.now(), side, pitchDeg: gameRotationEuler?.pitch ?? null, rollDeg: gameRotationEuler?.roll ?? null, yawDeg: gameRotationEuler?.heading ?? null });
    });
    pair.addEventListener("deviceLinearAcceleration", (e) => {
      const { side, linearAcceleration: a, timestamp } = e.message ?? {};
      if (!side || !a) return;
      const accG = Math.hypot(a.x, a.y, a.z) + 1; // linear acc excludes gravity; +1 g ≈ total
      let accWorld = null;
      if (quat[side]) {
        const w = rotate(quat[side], a);
        accWorld = { x: w.x * G, y: w.y * G };
      }
      h.onMotion({ t: timestamp ?? Date.now(), side, accG, accWorld });
    });
    pair.addEventListener("deviceStepDetector", (e) => h.onStep?.({ t: e.message?.timestamp ?? Date.now() }));
  }

  // Devices already connected when Steady opened (common in the phone app).
  for (const d of BW.DeviceManager?.connectedDevices ?? []) {
    if (/insole/i.test(String(d.type))) configure(d);
  }
  publish();

  const inFrame = (() => { try { return window.parent !== window; } catch { return true; } })();
  return {
    BW,
    env: inFrame ? "hub" : "browser",
    canPick: !inFrame && !!navigator.bluetooth,
    async pick() {
      // Standalone only: the browser's Bluetooth chooser, one insole at a time.
      return BW.Device.Connect();
    },
    async reconnectKnown() {
      try { await BW.DeviceManager.getDevices?.(); } catch { /* not supported */ }
    },
    vibrate(effect = "softBump100", sides = ["left", "right"]) {
      for (const d of BW.DeviceManager?.connectedDevices ?? []) {
        const side = d.side ?? (/left/i.test(String(d.type)) ? "left" : /right/i.test(String(d.type)) ? "right" : null);
        if (!/insole/i.test(String(d.type)) || !sides.includes(side)) continue;
        try { d.triggerVibration?.([{ type: "waveformEffect", segments: [{ effect }] }])?.catch?.(() => {}); } catch { /* not allowed */ }
      }
    },
    stop() {
      // Withdraw only Steady's own rate requests; the devices stay connected
      // for the person's other apps.
      for (const d of BW.DeviceManager?.connectedDevices ?? []) {
        if (!/insole/i.test(String(d.type))) continue;
        try { d.setSensorConfiguration?.({ pressure: 0, linearAcceleration: 0, gameRotation: 0, stepDetector: 0 })?.catch?.(() => {}); } catch { /* ignore */ }
      }
    },
  };
}
