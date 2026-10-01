// Runs the everyday monitor for the wearer: wearables in, day summaries out,
// safety events to the UI. One instance for the whole app.
import { state, set, update } from "./state.js";
import { createMonitor } from "../engine/monitor.js";
import { connectSdk } from "../sense/adapter.js";
import { startLiveSim } from "../sense/live-sim.js";
import { generate } from "../sense/simulator.js";
import { kv, prefs } from "../store/kv.js";

// Screens that show live readings re-render on each tick; others don't.
const LIVE_ROUTES = new Set(["today", "live", "station", "check", "exercise"]);

const HAPTIC = {
  cue: { effect: "softBump100" },
  success: { effect: "doubleClick100" },
  alarm: { effect: "alert750ms" },
  pause: { effect: "softBump60" },
  left: { effect: "sharpClick100", sides: ["left"] },
  right: { effect: "sharpClick100", sides: ["right"] },
};

function createService() {
  let api = null, demo = false, sdk = null, sim = null, monitor = null;
  let saveTimer = null, liveTimer = null, lastSync = 0;
  const frameSubs = new Set();
  let weighWaiter = null;
  const svc = {
    lastStoodAt: null,
    get monitor() { return monitor; },
    get demo() { return demo; },
    get sdk() { return sdk; },

    async start(o) {
      this.stop();
      api = o.api; demo = !!o.demo;
      monitor = createMonitor({ refLoad: demo ? 1000 : prefs.get("refLoad", null), onEvent: onMonitorEvent });
      if (!demo) {
        const raw = await kv.get("monitor-today");
        if (raw) monitor.restoreDay(raw);
      }
      setSense({ status: demo ? "live" : "off", env: demo ? "demo" : "standalone" });
      if (demo) {
        sim = startLiveSim({ onPressure: onPressure, onMotion: onMotion });
        setSense({ devices: [{ id: "sim-l", name: "Left insole (simulated)", side: "left", battery: 82, isInsole: true }, { id: "sim-r", name: "Right insole (simulated)", side: "right", battery: 79, isInsole: true }] });
      } else {
        const inFrame = (() => { try { return window.parent !== window; } catch { return true; } })();
        if (inFrame || prefs.get("sdkUsed", false)) this.connect();
      }
      liveTimer = setInterval(() => {
        monitor?.tick(Date.now());
        state.sense = { ...state.sense, live: monitor?.live() };
        if (LIVE_ROUTES.has(state.route.parts[0])) update();
      }, 500);
      saveTimer = setInterval(() => this.persist(), 60000);
    },

    async connect({ pick = false } = {}) {
      if (demo) return;
      if (!sdk) {
        sdk = await connectSdk({
          onPressure, onMotion,
          onStep: (f) => monitor?.step(f),
          onDevices: (devices) => setSense({ devices }),
          onStatus: (status) => setSense({ status }),
        });
        if (!sdk) return;
        prefs.set("sdkUsed", true);
        setSense({ env: sdk.env });
        if (sdk.env === "browser") await sdk.reconnectKnown();
      }
      if (pick && sdk.canPick) await sdk.pick().catch(() => {});
    },

    stop() {
      clearInterval(saveTimer); clearInterval(liveTimer);
      sim?.stop(); sim = null;
      if (sdk) { sdk.stop(); }
      sdk = null;
      if (monitor && !demo) this.persist();
      monitor = null;
    },

    async persist() {
      if (demo || !monitor || !api) return;
      const raw = monitor.rawToday();
      if (!raw) return;
      await kv.set("monitor-today", raw);
      const now = Date.now();
      if (now - lastSync > 5 * 60000) {
        lastSync = now;
        const today = monitor.today();
        if (today && today.minutes.worn > 0) api.putDays([today]).catch(() => { lastSync = 0; });
      }
    },

    onFrame(fn) { frameSubs.add(fn); return () => frameSubs.delete(fn); },

    vibrate(kind = "cue") {
      const h = HAPTIC[kind] ?? HAPTIC.cue;
      if (demo) { pulseUi(kind); return; }
      sdk?.vibrate(h.effect, h.sides);
    },

    weighIn() {
      return new Promise((resolve) => {
        weighWaiter = resolve;
        monitor?.startWeighIn(Date.now());
        if (demo) setTimeout(() => { weighWaiter?.({ ok: true, W: 1000 }); weighWaiter = null; }, 3000);
      });
    },

    /** Demo only: play a scripted movement once (e.g. for a Steady Check step). */
    play(script, { seed = 3 } = {}) {
      if (!demo) return () => {};
      sim?.stop();
      const frames = generate(script, { seed, t0: Date.now() + 50, motion: false });
      let i = 0;
      const timer = setInterval(() => {
        const now = Date.now();
        while (i < frames.pressure.length && frames.pressure[i].t <= now) onPressure(frames.pressure[i++]);
        if (now > frames.end + 500) { clearInterval(timer); sim = startLiveSim({ onPressure, onMotion }); }
      }, 40);
      return () => { clearInterval(timer); if (!sim) sim = startLiveSim({ onPressure, onMotion }); };
    },

    /** Demo/testing: trigger the possible-fall flow. */
    simulateFall() {
      onMonitorEvent("possibleFall", { t: Date.now(), impactG: 2.8, confidence: "higher", simulated: true });
    },

    dizzyContext() {
      const live = monitor?.live();
      const since = this.lastStoodAt ? Math.round((Date.now() - this.lastStoodAt) / 1000) : null;
      if (since != null && since <= 60) return { context: "standingUp", autoContext: `Within ${since} seconds of standing up` };
      if (live?.activity === "walk") return { context: "walking", autoContext: "While walking" };
      if (live?.activity?.startsWith("stand")) return { context: "standing", autoContext: "While standing" };
      if (live?.activity?.startsWith("sit")) return { context: "sitting", autoContext: "While sitting" };
      return { context: null, autoContext: null };
    },
  };

  function onPressure(f) {
    monitor?.pressure(f);
    for (const fn of frameSubs) fn("pressure", f);
  }
  function onMotion(f) {
    monitor?.motion(f);
    for (const fn of frameSubs) fn("motion", f);
  }
  function onMonitorEvent(type, data) {
    if (type === "calibrated" && !demo) prefs.set("refLoad", data.W);
    if (type === "weighIn" && weighWaiter) { weighWaiter(data); weighWaiter = null; }
    if (type === "possibleFall" && state.role === "wearer") set({ overlay: { kind: "fall", ...data, startedAt: Date.now() } });
    if (type === "stood") {
      svc.lastStoodAt = data.t;
      const program = state.profileCache?.program;
      if (program?.riseAndPause !== false && state.profileCache?.settings?.riseAndPauseAlways) svc.vibrate("pause");
      else if (program?.riseAndPause !== false && recentDizzy()) svc.vibrate("pause");
    }
    if (type === "day" && !demo && api) api.putDays([data]).catch(() => {});
  }
  function recentDizzy() {
    const ev = state.recentEvents ?? [];
    const since = Date.now() - 14 * 86400000;
    return ev.some((e) => e.kind === "dizzy" && new Date(e.at).getTime() > since);
  }
  return svc;
}

let pulse = null;
function pulseUi(kind) {
  clearTimeout(pulse);
  set({ hapticFlash: kind });
  pulse = setTimeout(() => set({ hapticFlash: null }), 700);
}

function setSense(patch) {
  state.sense = { ...state.sense, ...patch };
  update();
}

export const senseService = createService();
