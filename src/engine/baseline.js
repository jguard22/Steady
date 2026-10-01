// Personal baselines: "is this like your usual?"
//
// Each measure is compared with the wearer's own recent past, not with a
// population. The baseline is the median of a 28-day window that ends three
// days ago (so a fresh change can't hide inside its own baseline); spread is
// a robust SD (1.4826 × MAD) with a floor, so a very regular person doesn't
// get flagged for tiny wobbles. A change has to persist — 3 of the last 5
// days — before Steady calls it out. One odd day never raises anything.
//
// Wording rule: these are changes from the person's usual, never a
// diagnosis or a prediction of falls.

import { median, mad, mean, MAD_TO_SD, round } from "./stats.js";

export const METRICS = [
  { key: "walkMin", label: "Walking time", plain: "walking", get: (d) => d.minutes?.walk, adverse: "down", unit: "min", floor: 4, digits: 0, group: "activity" },
  { key: "steps", label: "Steps", plain: "steps", get: (d) => d.steps, adverse: "down", unit: "", floor: 400, digits: 0, group: "activity" },
  { key: "cadence", label: "Cadence", plain: "walking pace", get: (d) => d.gait?.cadenceSpm, adverse: "down", unit: "steps/min", floor: 2, digits: 0, group: "gait", primary: true },
  { key: "gaitSpeed", label: "Walking speed (est.)", plain: "walking speed", get: (d) => d.gait?.gaitSpeedMps, adverse: "down", unit: "m/s", floor: 0.04, digits: 2, group: "gait", primary: true },
  { key: "strideLength", label: "Stride length (est.)", plain: "stride length", get: (d) => d.gait?.strideLengthM, adverse: "down", unit: "m", floor: 0.04, digits: 2, group: "gait" },
  { key: "strideCv", label: "Stride-time variability", plain: "how even steps are", get: (d) => d.gait?.strideTimeCvPct, adverse: "up", unit: "%", floor: 0.6, digits: 1, group: "gait", primary: true },
  { key: "doubleSupport", label: "Double support", plain: "time on both feet while walking", get: (d) => d.gait?.doubleSupportPct, adverse: "up", unit: "%", floor: 1.5, digits: 1, group: "gait" },
  { key: "stepAsym", label: "Step asymmetry", plain: "favouring one side", get: (d) => d.gait?.stepAsymPct, adverse: "up", unit: "%", floor: 2, digits: 1, group: "gait" },
  { key: "sway", label: "Standing sway", plain: "sway while standing", get: (d) => d.balance?.swayRmsMm, adverse: "up", unit: "mm", floor: 0.8, digits: 1, group: "balance", primary: true },
  { key: "riseTime", label: "Sit-to-stand time", plain: "time to stand up", get: (d) => d.transitions?.riseTimeS, adverse: "up", unit: "s", floor: 0.15, digits: 1, group: "balance", primary: true },
  { key: "unsteady", label: "Unsteady moments", plain: "unsteady moments", get: (d) => d.events?.unsteady, adverse: "up", unit: "", kind: "count", digits: 0, group: "events" },
];

export const BY_KEY = Object.fromEntries(METRICS.map((m) => [m.key, m]));

export const BASELINE = {
  windowDays: 28,
  gapDays: 3,
  minDays: 7,
  minWornMin: 60,     // a day needs this much wear to count
  watchZ: 1.5,
  reviewZ: 2.5,
  sustainOf: 5,
  sustainNeed: 3,
  ewmaLambda: 0.4,
};

const DAY = 86400000;
const dateMs = (s) => Date.parse(`${s}T00:00:00Z`);
export const addDays = (s, n) => new Date(dateMs(s) + n * DAY).toISOString().slice(0, 10);

function usable(d) {
  return (d.minutes?.worn ?? 0) >= BASELINE.minWornMin;
}

/**
 * @param {object[]} days DailySummary records (any order)
 * @param {typeof METRICS[number]} metric
 * @param {string} asOf YYYY-MM-DD (the "today" being judged)
 */
export function baselineFor(days, metric, asOf) {
  const end = addDays(asOf, -BASELINE.gapDays);
  const start = addDays(end, -BASELINE.windowDays);
  const vals = days
    .filter((d) => d.date >= start && d.date < end && usable(d))
    .map((d) => metric.get(d))
    .filter((v) => v != null && Number.isFinite(v));
  if (vals.length < BASELINE.minDays) return { n: vals.length, median: null, spread: null, mean: null };
  const m = median(vals);
  const spread = Math.max((mad(vals) ?? 0) * MAD_TO_SD, metric.floor ?? 0, Math.abs(m) * 0.03);
  return { n: vals.length, median: m, spread, mean: mean(vals) };
}

/**
 * Compare the recent days with the baseline for one metric.
 */
export function evaluateMetric(days, metric, asOf) {
  const base = baselineFor(days, metric, asOf);
  const recentDays = days
    .filter((d) => d.date > addDays(asOf, -7) && d.date <= asOf && usable(d))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const recent = recentDays.map((d) => ({ date: d.date, value: metric.get(d) })).filter((r) => r.value != null);
  const out = { key: metric.key, baseline: base, recent, level: "learning", ewma: null, change: null, changePct: null, direction: "same" };
  if (base.median == null) return out;

  if (metric.kind === "count") {
    const lam = base.mean ?? 0;
    const sum = recent.reduce((a, r) => a + r.value, 0);
    const expected = lam * Math.max(1, recent.length);
    out.change = sum - expected;
    out.recentTotal = sum;
    out.expected = round(expected, 1);
    out.level =
      sum >= Math.max(5, expected + 3 * Math.sqrt(expected) + 2) ? "review"
        : sum >= Math.max(3, expected + 2 * Math.sqrt(expected) + 1) ? "watch" : "ok";
    out.direction = sum > expected + 1 ? "worse" : sum < expected - 1 ? "better" : "same";
    return out;
  }

  const sign = metric.adverse === "up" ? 1 : -1;
  let ewma = null;
  for (const r of recent) {
    r.z = (r.value - base.median) / base.spread;
    r.adverseZ = sign * r.z;
    ewma = ewma == null ? r.adverseZ : ewma + BASELINE.ewmaLambda * (r.adverseZ - ewma);
  }
  out.ewma = ewma != null ? round(ewma, 2) : null;
  const last = recent.slice(-BASELINE.sustainOf);
  const count = (z) => last.filter((r) => r.adverseZ >= z).length;
  const enough = last.length >= Math.min(BASELINE.sustainNeed, BASELINE.sustainOf);
  if (!recent.length) out.level = "nodata";
  else if (enough && (count(BASELINE.reviewZ) >= BASELINE.sustainNeed)) out.level = "review";
  else if (enough && (count(BASELINE.watchZ) >= BASELINE.sustainNeed)) out.level = "watch";
  else out.level = "ok";

  const recentMed = median(recent.map((r) => r.value));
  if (recentMed != null) {
    out.recentMedian = recentMed;
    out.change = recentMed - base.median;
    out.changePct = base.median ? (out.change / Math.abs(base.median)) * 100 : null;
    const adverse = sign * out.change;
    out.direction = Math.abs(out.change) < base.spread * 0.5 ? "same" : adverse > 0 ? "worse" : "better";
  }
  return out;
}

/**
 * Whole-person picture for a date: per-metric levels, overall status, data
 * coverage and plain-language notes.
 * @returns {{asOf:string, status:'learning'|'steady'|'watch'|'review'|'nodata', metrics:object[], coverage:object, notes:object[]}}
 */
export function evaluate(days, asOf, { events = [] } = {}) {
  const metrics = METRICS.map((m) => evaluateMetric(days, m, asOf));
  const baselineDays = days.filter((d) => d.date < addDays(asOf, -BASELINE.gapDays) && usable(d)).length;
  const last7 = days.filter((d) => d.date > addDays(asOf, -7) && d.date <= asOf);
  const wornDays7 = last7.filter(usable).length;
  const lastSeen = days.filter((d) => (d.minutes?.worn ?? 0) > 0).map((d) => d.date).sort().pop() ?? null;

  const watch = metrics.filter((m) => m.level === "watch");
  const review = metrics.filter((m) => m.level === "review");
  const recentFalls = events.filter((e) => e.kind === "possibleFall" && e.date > addDays(asOf, -7) && e.outcome !== "ok");
  let status;
  if (baselineDays < BASELINE.minDays) status = "learning";
  else if (wornDays7 === 0 || (lastSeen && lastSeen < addDays(asOf, -2))) status = "nodata";
  else if (review.some((m) => BY_KEY[m.key].primary) || review.length >= 2 || watch.length + review.length >= 3 || recentFalls.length) status = "review";
  else if (watch.length || review.length) status = "watch";
  else status = "steady";

  return {
    asOf,
    status,
    metrics,
    coverage: { baselineDays, wornDays7, lastSeen, learningDaysLeft: Math.max(0, BASELINE.minDays - baselineDays) },
    notes: notesFor(metrics),
  };
}

const PHRASE = {
  walkMin: { worse: "Walking less than usual", better: "Walking more than usual" },
  steps: { worse: "Fewer steps than usual", better: "More steps than usual" },
  cadence: { worse: "Walking at a slower pace than usual", better: "Walking at a brisker pace than usual" },
  gaitSpeed: { worse: "Walking more slowly than usual", better: "Walking faster than usual" },
  strideLength: { worse: "Taking shorter strides than usual", better: "Taking longer strides than usual" },
  strideCv: { worse: "Steps are less even than usual", better: "Steps are more even than usual" },
  doubleSupport: { worse: "Keeping both feet down longer while walking — a more cautious walk", better: "Walking with more confidence than usual" },
  stepAsym: { worse: "Favouring one side more than usual", better: "Walking more evenly side to side" },
  sway: { worse: "Swaying more while standing still", better: "Standing more steadily than usual" },
  riseTime: { worse: "Taking longer to stand up", better: "Standing up more easily than usual" },
  unsteady: { worse: "More unsteady moments while walking", better: "Fewer unsteady moments than usual" },
};

function notesFor(metrics) {
  const rank = { review: 0, watch: 1, ok: 2, learning: 3, nodata: 4 };
  return metrics
    .filter((m) => (m.level === "watch" || m.level === "review") || (m.level === "ok" && m.direction === "better" && BY_KEY[m.key].primary))
    .sort((a, b) => rank[a.level] - rank[b.level])
    .map((m) => {
      const def = BY_KEY[m.key];
      const dir = m.level === "ok" ? "better" : "worse";
      return {
        key: m.key,
        level: m.level,
        text: PHRASE[m.key][dir],
        detail: describeChange(def, m),
      };
    });
}

export function describeChange(def, m) {
  if (def.kind === "count") return `${m.recentTotal ?? 0} in the last 7 days (usual about ${round(m.expected ?? 0, 0)})`;
  if (m.recentMedian == null || m.baseline.median == null) return "";
  const f = (v) => `${round(v, def.digits)}${def.unit && def.unit !== "%" ? " " + def.unit : def.unit}`;
  return `${f(m.recentMedian)} this week, usual ${f(m.baseline.median)}`;
}

export const STATUS_TEXT = {
  learning: { title: "Learning your usual", wearer: "Steady is getting to know how you usually move. Keep wearing your insoles." },
  steady: { title: "Steady", wearer: "You're moving like your usual self." },
  watch: { title: "A little different", wearer: "A few things look a little different from your usual this week." },
  review: { title: "Worth a check-in", wearer: "Some things look different from your usual. It may be worth talking with someone on your care team." },
  nodata: { title: "No recent data", wearer: "Steady hasn't heard from your insoles lately." },
};
