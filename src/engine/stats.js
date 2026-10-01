// Small, dependency-free statistics helpers shared by the engine.
// Every function tolerates empty input and returns null instead of NaN.

/** @param {number[]} xs */
export function mean(xs) {
  if (!xs.length) return null;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Population standard deviation. @param {number[]} xs */
export function sd(xs) {
  const m = mean(xs);
  if (m == null || xs.length < 2) return null;
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return Math.sqrt(s / xs.length);
}

/** Coefficient of variation in percent. @param {number[]} xs */
export function cvPct(xs) {
  const m = mean(xs);
  const s = sd(xs);
  if (m == null || s == null || m === 0) return null;
  return (s / m) * 100;
}

/** Linear-interpolated percentile, p in [0, 100]. @param {number[]} xs @param {number} p */
export function percentile(xs, p) {
  if (!xs.length) return null;
  const a = [...xs].sort((u, v) => u - v);
  const r = (p / 100) * (a.length - 1);
  const lo = Math.floor(r);
  const hi = Math.ceil(r);
  return a[lo] + (a[hi] - a[lo]) * (r - lo);
}

/** @param {number[]} xs */
export const median = (xs) => percentile(xs, 50);

/** Median absolute deviation (raw, unscaled). @param {number[]} xs */
export function mad(xs) {
  const m = median(xs);
  if (m == null) return null;
  return median(xs.map((x) => Math.abs(x - m)));
}

/** Robust z-score scale: 1.4826 * MAD approximates SD for normal data. */
export const MAD_TO_SD = 1.4826;

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** Round to n decimals, passing null through. */
export function round(x, n = 0) {
  if (x == null || !Number.isFinite(x)) return null;
  const f = 10 ** n;
  return Math.round(x * f) / f;
}

/** Weighted median of {value, weight} pairs. */
export function weightedMedian(pairs) {
  const a = pairs.filter((p) => p.value != null && Number.isFinite(p.value) && p.weight > 0)
    .sort((u, v) => u.value - v.value);
  if (!a.length) return null;
  const total = a.reduce((s, p) => s + p.weight, 0);
  let acc = 0;
  for (const p of a) {
    acc += p.weight;
    if (acc >= total / 2) return p.value;
  }
  return a[a.length - 1].value;
}
