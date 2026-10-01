// Quiet-standing sway from the combined centre of pressure (CoP).
//
// Coordinates are millimetres in a pair frame (x: left→right across both
// feet, y: heel→toe). The insoles give each foot's CoP as a 0–1 position on
// that foot; `pairCop` places both on an assumed stance so sway reads in
// familiar units. Absolute sizes are estimates (foot size and stance width
// vary); changes over time are what Steady compares.

import { mean, round } from "./stats.js";

export const GEOMETRY = {
  footLengthMm: 260,
  footWidthMm: 95,
  stanceWidthMm: 200, // centre-to-centre of the two feet in a relaxed stance
};

/**
 * Combined CoP from per-foot loads and per-foot CoP (0–1 each axis).
 * @returns {{x:number,y:number}|null} mm in the pair frame
 */
export function pairCop(loadL, copL, loadR, copR, g = GEOMETRY) {
  const total = (loadL > 0 ? loadL : 0) + (loadR > 0 ? loadR : 0);
  if (total <= 0) return null;
  const pts = [];
  if (loadL > 0 && copL) pts.push({ w: loadL, x: -g.stanceWidthMm / 2 + (copL.x - 0.5) * g.footWidthMm, y: copL.y * g.footLengthMm });
  if (loadR > 0 && copR) pts.push({ w: loadR, x: g.stanceWidthMm / 2 + (copR.x - 0.5) * g.footWidthMm, y: copR.y * g.footLengthMm });
  if (!pts.length) return null;
  const w = pts.reduce((a, p) => a + p.w, 0);
  return { x: pts.reduce((a, p) => a + p.x * p.w, 0) / w, y: pts.reduce((a, p) => a + p.y * p.w, 0) / w };
}

/**
 * Sway measures over one window of CoP samples.
 * @param {{t:number,x:number,y:number}[]} pts
 */
export function analyzeSway(pts) {
  if (pts.length < 20) return null;
  const mx = mean(pts.map((p) => p.x));
  const my = mean(pts.map((p) => p.y));
  let sxx = 0, syy = 0, sxy = 0, path = 0;
  for (let i = 0; i < pts.length; i++) {
    const dx = pts[i].x - mx;
    const dy = pts[i].y - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
    if (i) path += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  const n = pts.length;
  sxx /= n; syy /= n; sxy /= n;
  // 95% confidence ellipse area: π · χ²(2, .95) · sqrt(det Σ)
  const det = Math.max(0, sxx * syy - sxy * sxy);
  const durS = (pts[n - 1].t - pts[0].t) / 1000;
  return {
    durationS: round(durS, 1),
    rmsMm: round(Math.sqrt(sxx + syy), 2),
    rmsMlMm: round(Math.sqrt(sxx), 2),
    rmsApMm: round(Math.sqrt(syy), 2),
    areaMm2: round(Math.PI * 5.991 * Math.sqrt(det), 1),
    velocityMmS: durS > 0 ? round(path / durS, 1) : null,
    meanX: round(mx, 1),
    meanY: round(my, 1),
  };
}

/** Lightweight low-pass for noisy CoP: exponential smoothing at ~5 Hz cut-off. */
export function createSmoother(alpha = 0.35) {
  let last = null;
  return (p) => {
    if (!p) return null;
    last = last ? { x: last.x + alpha * (p.x - last.x), y: last.y + alpha * (p.y - last.y) } : { ...p };
    return { ...last };
  };
}
