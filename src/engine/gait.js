// Gait-bout analysis from per-foot contact intervals.
//
// A bout is a stretch of continuous walking. Input is the list of foot
// contacts in that stretch: [{side, on, off, peak?, strike?, toeUpDeg?,
// rollDeg?, strideLengthM?}], times in ms. Output is one record of
// spatiotemporal measures. Pure: no DOM, no clocks.

import { median, cvPct, mean, round, MAD_TO_SD, mad } from "./stats.js";

export const GAIT = {
  minBoutMs: 5000,        // the original concept: "straight-line walking for more than five seconds"
  minContacts: 6,
  maxStepMs: 2000,        // longer than this between alternating contacts = not one walk
  minStepMs: 250,
  trimContacts: 2,        // drop acceleration/deceleration steps at each end
};

const other = (s) => (s === "left" ? "right" : "left");

/**
 * Time both feet are on the ground, as a share of the analysed span.
 * @param {{side:string,on:number,off:number}[]} contacts sorted by `on`
 * @param {number} t0 @param {number} t1
 */
export function doubleSupportShare(contacts, t0, t1) {
  if (t1 <= t0) return null;
  const left = contacts.filter((c) => c.side === "left");
  const right = contacts.filter((c) => c.side === "right");
  let both = 0;
  let j = 0;
  for (const a of left) {
    while (j < right.length && right[j].off < a.on) j++;
    for (let k = j; k < right.length && right[k].on < a.off; k++) {
      const s = Math.max(a.on, right[k].on, t0);
      const e = Math.min(a.off, right[k].off, t1);
      if (e > s) both += e - s;
    }
  }
  return both / (t1 - t0);
}

/**
 * @param {{side:'left'|'right',on:number,off:number,peak?:number,strike?:string,toeUpDeg?:number,rollDeg?:number,strideLengthM?:number}[]} raw
 */
export function analyzeBout(raw) {
  const contacts = raw.filter((c) => c.off > c.on).sort((a, b) => a.on - b.on);
  if (contacts.length < GAIT.minContacts) return null;
  const spanMs = contacts[contacts.length - 1].off - contacts[0].on;
  if (spanMs < GAIT.minBoutMs) return null;

  const trim = contacts.length >= 10 ? GAIT.trimContacts : 1;
  const steady = contacts.slice(trim, contacts.length - trim);
  if (steady.length < 4) return null;

  // Step times: alternating-side consecutive initial contacts.
  const steps = { left: [], right: [] };
  for (let i = 1; i < steady.length; i++) {
    const a = steady[i - 1];
    const b = steady[i];
    const dt = b.on - a.on;
    if (b.side === other(a.side) && dt >= GAIT.minStepMs && dt <= GAIT.maxStepMs) steps[b.side].push(dt);
  }
  // Stride times, stance, swing per side.
  const strides = { left: [], right: [] };
  const stance = { left: [], right: [] };
  const swing = { left: [], right: [] };
  const peaks = { left: [], right: [] };
  for (const side of ["left", "right"]) {
    const cs = steady.filter((c) => c.side === side);
    for (let i = 0; i < cs.length; i++) {
      stance[side].push(cs[i].off - cs[i].on);
      if (cs[i].peak != null) peaks[side].push(cs[i].peak);
      if (i > 0) {
        const st = cs[i].on - cs[i - 1].on;
        if (st <= 2 * GAIT.maxStepMs) {
          strides[side].push(st);
          swing[side].push(cs[i].on - cs[i - 1].off);
        }
      }
    }
  }
  const allStrides = [...strides.left, ...strides.right];
  if (allStrides.length < 2) return null;
  const strideTimeMs = median(allStrides);

  // Pooled CV: mean of per-side CVs weighted by count (avoids L/R offset
  // inflating variability).
  const sideCv = ["left", "right"]
    .filter((s) => strides[s].length >= 2)
    .map((s) => ({ cv: cvPct(strides[s]), n: strides[s].length }));
  const nCv = sideCv.reduce((a, s) => a + s.n, 0);
  const strideTimeCvPct = nCv ? sideCv.reduce((a, s) => a + s.cv * s.n, 0) / nCv : null;

  const asym = (a, b) => (a != null && b != null && a + b > 0 ? (Math.abs(a - b) / ((a + b) / 2)) * 100 : null);
  const stepL = median(steps.left);
  const stepR = median(steps.right);
  const stanceL = median(stance.left);
  const stanceR = median(stance.right);

  const t0 = steady[0].on;
  const t1 = steady[steady.length - 1].off;
  const ds = doubleSupportShare(steady, t0, t1);

  // Point of contact: share of initial contacts per region.
  const strikes = steady.map((c) => c.strike).filter(Boolean);
  const strikePct = strikes.length
    ? Object.fromEntries(["heel", "mid", "fore", "toe"].map((r) => [r, (strikes.filter((s) => s === r).length / strikes.length) * 100]))
    : null;

  const angle = (key, side) => median(steady.filter((c) => (!side || c.side === side) && c[key] != null).map((c) => c[key]));
  const lengths = steady.map((c) => c.strideLengthM).filter((x) => x != null && x > 0.1 && x < 2.5);
  const strideLengthM = lengths.length >= 3 ? median(lengths) : null;

  return {
    t0: contacts[0].on,
    t1: contacts[contacts.length - 1].off,
    durationS: round(spanMs / 1000, 1),
    steps: contacts.length,
    cadenceSpm: round(120000 / strideTimeMs, 1),
    strideTimeMs: round(strideTimeMs),
    strideTimeCvPct: round(strideTimeCvPct, 2),
    stepTimeMs: { left: round(stepL), right: round(stepR) },
    stanceMs: { left: round(stanceL), right: round(stanceR) },
    stancePct: round(mean([...stance.left, ...stance.right]) / strideTimeMs * 100, 1),
    swingMs: { left: round(median(swing.left)), right: round(median(swing.right)) },
    doubleSupportPct: ds != null ? round(ds * 100, 1) : null,
    stepAsymPct: round(asym(stepL, stepR), 1),
    stanceAsymPct: round(asym(stanceL, stanceR), 1),
    loadAsymPct: round(asym(median(peaks.left), median(peaks.right)), 1),
    strikePct,
    toeUpDeg: { left: round(angle("toeUpDeg", "left"), 1), right: round(angle("toeUpDeg", "right"), 1) },
    rollDeg: { left: round(angle("rollDeg", "left"), 1), right: round(angle("rollDeg", "right"), 1) },
    strideLengthM: round(strideLengthM, 2),
    gaitSpeedMps: strideLengthM != null ? round(strideLengthM / (strideTimeMs / 1000), 2) : null,
    // Unsteady moments: a step far outside this walk's own rhythm,
    // followed by a quick catch step. Heuristic, kept per bout so it can be
    // re-tuned against labelled data.
    unsteadyMoments: findUnsteadySteps(steady),
  };
}

/**
 * Steps that break the walker's own rhythm: a step time beyond
 * max(4 robust SDs, 35%) of the bout median, immediately followed by a step
 * shorter than 70% of the median (a catch step). Returns timestamps.
 */
export function findUnsteadySteps(steady) {
  const stepTimes = [];
  for (let i = 1; i < steady.length; i++) {
    if (steady[i].side !== steady[i - 1].side) stepTimes.push({ t: steady[i].on, dt: steady[i].on - steady[i - 1].on });
  }
  if (stepTimes.length < 6) return [];
  const dts = stepTimes.map((s) => s.dt);
  const m = median(dts);
  const spread = Math.max((mad(dts) ?? 0) * MAD_TO_SD * 4, m * 0.35);
  const out = [];
  for (let i = 0; i < stepTimes.length - 1; i++) {
    const s = stepTimes[i];
    const next = stepTimes[i + 1];
    if (Math.abs(s.dt - m) > spread && next.dt < m * 0.7) out.push(s.t);
  }
  return out;
}

/**
 * Combine bouts into one day's gait record, weighting each bout by its
 * step count. Only bouts that pass the five-second rule count.
 */
export function summarizeBouts(bouts) {
  const ok = bouts.filter(Boolean);
  if (!ok.length) return null;
  const w = (key) => weightedBy(ok, (b) => b[key]);
  const strike = ok.filter((b) => b.strikePct);
  const strikePct = strike.length
    ? Object.fromEntries(["heel", "mid", "fore", "toe"].map((r) => [r, round(weightedMean(strike.map((b) => ({ value: b.strikePct[r], weight: b.steps }))), 1)]))
    : null;
  const sideMed = (key, side) => round(weightedBy(ok, (b) => b[key]?.[side]), 1);
  return {
    boutCount: ok.length,
    walkSteps: ok.reduce((a, b) => a + b.steps, 0),
    longestBoutS: Math.max(...ok.map((b) => b.durationS)),
    cadenceSpm: round(w("cadenceSpm"), 1),
    strideTimeMs: round(w("strideTimeMs")),
    strideTimeCvPct: round(w("strideTimeCvPct"), 2),
    stancePct: round(w("stancePct"), 1),
    doubleSupportPct: round(w("doubleSupportPct"), 1),
    stepAsymPct: round(w("stepAsymPct"), 1),
    stanceAsymPct: round(w("stanceAsymPct"), 1),
    loadAsymPct: round(w("loadAsymPct"), 1),
    strideLengthM: round(w("strideLengthM"), 2),
    gaitSpeedMps: round(w("gaitSpeedMps"), 2),
    stepTimeMs: { left: sideMed("stepTimeMs", "left"), right: sideMed("stepTimeMs", "right") },
    toeUpDeg: { left: sideMed("toeUpDeg", "left"), right: sideMed("toeUpDeg", "right") },
    rollDeg: { left: sideMed("rollDeg", "left"), right: sideMed("rollDeg", "right") },
    strikePct,
    unsteadyMoments: ok.reduce((a, b) => a + (b.unsteadyMoments?.length ?? 0), 0),
  };
}

function weightedBy(bouts, get) {
  const pairs = bouts.map((b) => ({ value: get(b), weight: b.steps })).filter((p) => p.value != null);
  if (!pairs.length) return null;
  // weighted median: robust to one odd walk
  pairs.sort((a, b) => a.value - b.value);
  const total = pairs.reduce((a, p) => a + p.weight, 0);
  let acc = 0;
  for (const p of pairs) {
    acc += p.weight;
    if (acc >= total / 2) return p.value;
  }
  return pairs[pairs.length - 1].value;
}

function weightedMean(pairs) {
  const ok = pairs.filter((p) => p.value != null);
  const total = ok.reduce((a, p) => a + p.weight, 0);
  return total ? ok.reduce((a, p) => a + p.value * p.weight, 0) / total : null;
}

