// Synthetic insole wearer.
//
// Produces the same frames the real adapter does (pressure per foot with
// CoP and foot regions, motion with orientation and world-frame horizontal
// acceleration), so every algorithm is exercised end to end without
// hardware. Deterministic for a given seed.
//
// Script segments: {kind:'walk'|'stand'|'sit'|'rise'|'sitDown'|'fall'|'stumble'|'off', s, ...params}

export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEFAULT_WEARER = {
  W: 1000,              // whole-body load on the insoles, arbitrary units
  cadence: 104,         // steps/min
  strideCv: 2.0,        // % stride-time variability
  stanceFrac: 0.62,
  asymmetry: 0,         // + = left stance longer, as a fraction
  strideLengthM: 1.15,
  swayMm: 6,            // quiet-standing sway amplitude
  riseS: 1.4,
  swingResidual: 0.12,  // unloaded insole still reads this share of W
  noise: 0.015,
};

const REGIONS = [
  ["heel", 0.12], ["mid", 0.42], ["fore", 0.72], ["toe", 0.92],
];
function regionsAt(load, y) {
  const out = {};
  let tot = 0;
  for (const [r, cy] of REGIONS) { const v = Math.exp(-((y - cy) ** 2) / 0.02); out[r] = v; tot += v; }
  for (const [r] of REGIONS) out[r] = tot ? (out[r] / tot) * load : 0;
  return out;
}

/**
 * Generate frames for a script.
 * @param {object[]} script
 * @param {{seed?:number, t0?:number, hz?:number, wearer?:object, motion?:boolean}} o
 * @returns {{pressure:object[], motion:object[], end:number}}
 */
export function generate(script, o = {}) {
  const R = rng(o.seed ?? 7);
  const P = { ...DEFAULT_WEARER, ...(o.wearer ?? {}) };
  const hz = o.hz ?? 50;
  const dt = 1000 / hz;
  let t = o.t0 ?? Date.UTC(2026, 8, 1, 14, 0, 0);
  const pressure = [];
  const motion = [];
  const withMotion = o.motion ?? true;
  const noise = () => (R() - 0.5) * 2 * P.noise * P.W;

  const push = (side, load, y, x = 0.5, m = null) => {
    const l = Math.max(0, load + noise());
    pressure.push({ t: Math.round(t), side, load: l, cop: { x, y }, regions: regionsAt(l, y) });
    if (withMotion) motion.push({ t: Math.round(t), side, accG: m?.accG ?? 1 + (R() - 0.5) * 0.04, pitchDeg: m?.pitch ?? (R() - 0.5), rollDeg: m?.roll ?? (R() - 0.5), accWorld: m?.acc ?? { x: 0, y: 0 } });
  };

  for (const seg of script) {
    const p = { ...P, ...seg };
    const n = Math.round((seg.s * 1000) / dt);
    if (seg.kind === "walk") {
      // build per-foot contact timelines with jitter
      const stepMs = 60000 / p.cadence;
      const strideMs = stepMs * 2;
      const tl = { left: [], right: [] };
      let tt = 0;
      let side = "left";
      while (tt < seg.s * 1000) {
        const jitter = 1 + gauss(R) * (p.strideCv / 100) / Math.SQRT2;
        const thisStep = stepMs * jitter;
        const asym = side === "left" ? 1 + p.asymmetry / 2 : 1 - p.asymmetry / 2;
        const stance = strideMs * p.stanceFrac * asym * jitter;
        tl[side].push({ on: tt, off: tt + stance });
        tt += thisStep;
        side = side === "left" ? "right" : "left";
      }
      if (seg.stumbleAt != null) injectStumble(tl, seg.stumbleAt * 1000, stepMs);
      for (let i = 0; i < n; i++) {
        const local = i * dt;
        // Each foot's share of a whole-body load that stays near W (plus a
        // small dynamic bump), so double support splits the weight the way
        // a real walk does.
        const st = {};
        for (const s of ["left", "right"]) {
          const c = tl[s].find((k) => local >= k.on && local < k.off);
          if (c) {
            const ph = (local - c.on) / (c.off - c.on);
            st[s] = { c, ph, w: Math.min(1, ph * 6) * Math.min(1, (1 - ph) * 6) + 0.02 };
          }
        }
        const wsum = (st.left?.w ?? 0) + (st.right?.w ?? 0);
        for (const s of ["left", "right"]) {
          const k = st[s];
          if (k) {
            const { ph } = k;
            const dyn = 1 + 0.1 * Math.sin(Math.PI * ph * 2 - Math.PI / 2) ** 2;
            const load = p.W * dyn * (k.w / wsum) * (1 - p.swingResidual) + p.W * p.swingResidual;
            const pitch = ph < 0.08 ? 14 * (1 - ph / 0.08) : ph > 0.75 ? -25 * ((ph - 0.75) / 0.25) : 0;
            const accG = ph < 0.05 ? 1.6 + R() * 0.5 : 1 + (R() - 0.5) * 0.1;
            push(s, load, 0.07 + 0.83 * ph, 0.5, { pitch, accG, acc: { x: 0, y: 0 } });
          } else {
            // swing: forward acceleration then deceleration (ZUPT-able)
            const prev = [...tl[s]].reverse().find((q) => q.off <= local);
            const next = tl[s].find((q) => q.on > local);
            let acc = { x: 0, y: 0 }, pitch = -10;
            if (prev && next) {
              const Tsw = (next.on - prev.off) / 1000;
              const u = (local - prev.off) / 1000;
              const A = (2 * Math.PI * p.strideLengthM) / (Tsw * Tsw);
              acc = { x: 0, y: A * Math.sin((2 * Math.PI * u) / Tsw) };
              pitch = -20 + 34 * (u / Tsw);
            }
            push(s, p.W * p.swingResidual, 0.5, 0.5, { pitch, acc });
          }
        }
        t += dt;
      }
    } else if (seg.kind === "stand" || seg.kind === "tandem" || seg.kind === "oneLeg") {
      const amp = p.swayMm;
      const f1 = 0.21 + R() * 0.05, f2 = 0.17 + R() * 0.05;
      for (let i = 0; i < n; i++) {
        const u = (i * dt) / 1000;
        const ml = amp * (Math.sin(2 * Math.PI * f1 * u) + 0.4 * gauss(R) * 0.3);
        const ap = amp * (Math.sin(2 * Math.PI * f2 * u + 1.1) + 0.4 * gauss(R) * 0.3);
        let share = 0.5 + (p.shift ?? 0) + ml / 200; // right share shifts with ML sway
        if (seg.kind === "oneLeg") share = seg.side === "left" ? 0.02 : 0.98;
        const yMid = (seg.y ?? 0.45) + ap / 260;
        push("left", p.W * (1 - share), yMid, 0.5);
        push("right", p.W * share, yMid, 0.5);
        t += dt;
      }
    } else if (seg.kind === "sit") {
      for (let i = 0; i < n; i++) {
        const l = seg.raised === "left" ? 0 : 0.12 * p.W;
        const r = seg.raised === "right" ? 0 : 0.12 * p.W;
        push("left", l, 0.35); push("right", r, 0.35);
        t += dt;
      }
    } else if (seg.kind === "rise" || seg.kind === "sitDown") {
      const dur = (seg.kind === "rise" ? p.riseS : 1.2) * 1000;
      const steps = Math.round(dur / dt);
      for (let i = 0; i < steps; i++) {
        let u = i / steps;
        if (seg.kind === "sitDown") u = 1 - u;
        const c = 0.24 + (1.0 - 0.24) * u + 0.2 * Math.sin(Math.PI * u);
        push("left", (p.W * c) / 2, 0.55); push("right", (p.W * c) / 2, 0.55);
        t += dt;
      }
      // hold the end state for the rest of the segment
      for (let i = steps; i < n; i++) {
        const c = seg.kind === "rise" ? 1 : 0.24;
        push("left", (p.W * c) / 2, 0.45); push("right", (p.W * c) / 2, 0.45);
        t += dt;
      }
    } else if (seg.kind === "fall") {
      for (let i = 0; i < n; i++) {
        const u = (i * dt) / 1000;
        const c = u < 0.25 ? 1 - u * 4 : 0;
        const m = u > 0.2 && u < 0.4 ? { accG: 3.4, pitch: 70, roll: 40 } : { accG: 1, pitch: 70, roll: 40 };
        push("left", (p.W * c) / 2, 0.5, 0.5, m); push("right", (p.W * c) / 2, 0.5, 0.5, m);
        t += dt;
      }
    } else if (seg.kind === "off") {
      t += seg.s * 1000;
    }
  }
  return { pressure, motion, end: t };
}

function injectStumble(tl, atMs, stepMs) {
  // one long step then a quick catch step on the other foot
  const all = [...tl.left.map((c) => ({ ...c, side: "left" })), ...tl.right.map((c) => ({ ...c, side: "right" }))].sort((a, b) => a.on - b.on);
  const i = all.findIndex((c) => c.on >= atMs);
  if (i < 2 || i + 2 >= all.length) return;
  const delay = stepMs * 0.6;
  for (let k = i; k < all.length; k++) {
    const shift = k === i ? delay : delay - stepMs * 0.4;
    all[k].on += shift; all[k].off += shift;
  }
  tl.left = all.filter((c) => c.side === "left");
  tl.right = all.filter((c) => c.side === "right");
}

function gauss(R) {
  const u = Math.max(1e-9, R());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * R());
}

/** Merge pressure + motion frames in time order and feed a monitor. */
export function feed(monitor, frames) {
  const all = [
    ...frames.pressure.map((f) => ({ k: "p", f })),
    ...frames.motion.map((f) => ({ k: "m", f })),
  ].sort((a, b) => a.f.t - b.f.t || (a.k === "m" ? -1 : 1));
  for (const { k, f } of all) {
    if (k === "m") monitor.motion(f);
    else monitor.pressure(f);
  }
  monitor.tick(frames.end + 5000);
}
