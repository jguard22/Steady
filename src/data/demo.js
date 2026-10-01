// Demo personas with synthetic, deterministic histories.
//
// Margaret's story is the one the whole app is built around: a steady
// baseline; a new blood-pressure medicine twelve days ago; then dizziness
// soon after standing up, more sway, slower rises, slower and less even
// walking, unsteady moments — and a possible fall she answered "I'm OK".
// Steady notices the change days before it becomes a fall. All names and
// data here are fictional.

import { rng } from "../sense/simulator.js";
import { addDays } from "../engine/baseline.js";

export function localToday() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

const clampN = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;

/**
 * Persona definitions. `effect(dayIndexFromEnd)` returns multipliers for the
 * story (0 = today, 1 = yesterday …).
 */
export const PERSONAS = {
  margaret: {
    id: "demo-margaret", displayName: "Margaret Ellis", birthYear: 1948, sex: "female",
    plan: "FAMILY", tags: ["Vestibular referral", "Hypertension"], seed: 11, days: 84,
    base: { cadence: 102, cv: 2.4, ds: 25, sway: 6.4, rise: 1.5, walk: 44, steps: 4400, speed: 0.98, stride: 1.15, asym: 3.2, worn: 640 },
    effect: (k) => {
      if (k > 11) return null;
      // onset two days after the medicine started, building over a week
      const g = clampN((11 - k) / 7, 0, 1);
      return { cadence: 1 - 0.085 * g, cv: 1 + 0.85 * g, ds: 1 + 0.16 * g, sway: 1 + 0.48 * g, rise: 1 + 0.38 * g, walk: 1 - 0.34 * g, steps: 1 - 0.3 * g, speed: 1 - 0.12 * g, stride: 1 - 0.06 * g, asym: 1 + 0.4 * g, unsteady: 2.2 * g, dizzy: g > 0.3 ? 0.35 : 0 };
    },
    events: [
      { k: 12, kind: "medChange", hour: 9, detail: { text: "Started a new blood-pressure medicine (morning dose)", by: "Dana (daughter)" } },
      { k: 9, kind: "dizzy", hour: 7, detail: { context: "standingUp", autoContext: "Within 8 seconds of standing up", text: "Light-headed getting out of bed" } },
      { k: 6, kind: "dizzy", hour: 15, detail: { context: "standingUp", autoContext: "Within 5 seconds of standing up" } },
      { k: 4, kind: "possibleFall", hour: 15, minute: 12, outcome: "ok", detail: { impactG: 2.6, confidence: "higher", text: "Answered “I'm OK” after 14 s" } },
      { k: 3, kind: "dizzy", hour: 8, detail: { context: "standingUp", autoContext: "Within 6 seconds of standing up" } },
      { k: 2, kind: "note", hour: 11, detail: { text: "Spoke with Margaret — she's been rushing up from her chair. Reminded her to pause before walking.", by: "Dr. Ana Rivera, PT" } },
      { k: 1, kind: "practice", hour: 10, detail: { exercise: "weightShift", reps: 8, durationS: 212, score: 81 } },
      { k: 2, kind: "practice", hour: 16, detail: { exercise: "heelRaise", reps: 10, durationS: 145 } },
      { k: 4, kind: "practice", hour: 10, detail: { exercise: "steadyStance", durationS: 75 } },
      { k: 6, kind: "practice", hour: 9, detail: { exercise: "sitToStand", reps: 10, durationS: 160 } },
      { k: 10, kind: "practice", hour: 10, detail: { exercise: "weightShift", reps: 8, durationS: 190, score: 88 } },
      { k: 13, kind: "sensation", hour: 15, detail: { exercise: "sensation", left: "4/4", right: "4/4", falseAlarms: 0, score: 100 } },
    ],
    checks: { every: 7, baseScore: 74, drop: 15 },
  },
  walter: {
    id: "demo-walter", displayName: "Walter Ellis", birthYear: 1944, sex: "male",
    plan: "FAMILY", tags: ["Knee osteoarthritis"], seed: 23, days: 84,
    base: { cadence: 98, cv: 2.9, ds: 27, sway: 7.8, rise: 1.8, walk: 36, steps: 3600, speed: 0.9, stride: 1.1, asym: 5.1, worn: 590 },
    effect: () => null,
    events: [],
    checks: { every: 7, baseScore: 66, drop: 0 },
  },
};

// Clinic panel: a realistic mix of statuses for a balance practice.
const CLINIC_PEOPLE = [
  ["Harold Brooks", 1941, "male", ["Parkinson's"], "decline", 31],
  ["Rosa Delgado", 1946, "female", ["Diabetic neuropathy"], "steady", 32],
  ["Mei Lin Chen", 1950, "female", ["BPPV"], "improving", 33],
  ["James Whitaker", 1938, "male", ["History of falls", "Walker at home"], "watch", 34],
  ["Doris Okafor", 1944, "female", ["Post hip replacement"], "improving", 35],
  ["Frank Russo", 1949, "male", ["Vestibular hypofunction"], "steady", 36],
  ["Evelyn Park", 1937, "female", ["Macular degeneration"], "nodata", 37],
  ["Samuel Greene", 1952, "male", ["Peripheral neuropathy"], "learning", 38],
  ["Gloria Mendes", 1947, "female", ["Osteoporosis"], "steady", 39],
  ["Arthur Nguyen", 1940, "male", ["Stroke (2024)"], "watch", 40],
  ["Beatrice Holm", 1943, "female", ["Ménière's disease"], "decline", 41],
];

export const CLINICIAN = { displayName: "Dr. Ana Rivera, PT, DPT", practice: "Lakeside Balance Center (demo)" };
export const FAMILY = { displayName: "Dana Ellis", relation: "daughter" };

function storyEffect(kind) {
  if (kind === "decline") return (k) => (k > 14 ? null : ((g) => ({ cadence: 1 - 0.07 * g, cv: 1 + 0.6 * g, ds: 1 + 0.12 * g, sway: 1 + 0.35 * g, rise: 1 + 0.3 * g, walk: 1 - 0.3 * g, steps: 1 - 0.28 * g, speed: 1 - 0.1 * g, stride: 1 - 0.05 * g, asym: 1 + 0.3 * g, unsteady: 1.6 * g }))(clampN((14 - k) / 10, 0, 1)));
  if (kind === "watch") return (k) => (k > 9 ? null : ((g) => ({ cadence: 1 - 0.035 * g, cv: 1 + 0.32 * g, sway: 1 + 0.18 * g, walk: 1 - 0.18 * g, steps: 1 - 0.15 * g, rise: 1 + 0.1 * g }))(clampN((9 - k) / 6, 0, 1)));
  if (kind === "improving") return (k) => (k > 40 ? { cadence: 0.92, cv: 1.5, sway: 1.35, rise: 1.3, walk: 0.7, steps: 0.7, speed: 0.88 } : ((g) => ({ cadence: 1 - 0.08 * g, cv: 1 + 0.5 * g, sway: 1 + 0.35 * g, rise: 1 + 0.3 * g, walk: 1 - 0.3 * g, steps: 1 - 0.3 * g, speed: 1 - 0.12 * g }))(clampN((k - 5) / 35, 0, 1)));
  return () => null;
}

/** Build one synthetic DailySummary. */
function synthDay(date, b, eff, R) {
  const n = (sd) => (R() - 0.5) * 2 * sd; // uniform jitter
  const e = eff ?? {};
  const m = (key) => e[key] ?? 1;
  const worn = clampN(b.worn + n(60), 380, 840);
  const walk = clampN(b.walk * m("walk") + n(b.walk * 0.18), 6, 140);
  const stand = clampN(150 + n(35), 60, 260);
  const run = 0;
  const sit = Math.max(60, worn - walk - stand - 40);
  const cadence = b.cadence * m("cadence") + n(1.6);
  const strideTime = 120000 / cadence;
  const cv = b.cv * m("cv") + n(0.3);
  const unsteady = Math.max(0, Math.round((e.unsteady ?? 0) + (R() < 0.08 ? 1 : 0) + n(0.6)));
  const sway = b.sway * m("sway") + n(0.55);
  const stride = b.stride * m("stride") + n(0.03);
  const speed = b.speed * m("speed") + n(0.03);
  const rise = b.rise * m("rise") + n(0.12);
  const leftShare = 50.5 + n(1.5);
  return {
    date, algo: 1,
    minutes: {
      worn: r1(worn), walk: r1(walk), run, stand: r1(stand), standLeft: r1(stand * 0.08 + n(2)), standRight: r1(stand * 0.07 + n(2)),
      sit: r1(sit), sitLeftRaised: r1(clampN(18 + n(10), 0, 60)), sitRightRaised: r1(clampN(14 + n(9), 0, 60)), unloaded: r1(clampN(30 + n(15), 0, 90)),
    },
    steps: Math.round(b.steps * m("steps") + n(b.steps * 0.16)),
    gait: {
      boutCount: Math.round(walk / 2.2), walkSteps: Math.round(walk * cadence * 0.72), longestBoutS: Math.round(90 + R() * 400),
      cadenceSpm: r1(cadence), strideTimeMs: Math.round(strideTime), strideTimeCvPct: r2(Math.max(0.8, cv)),
      stancePct: r1(62 + (m("ds") - 1) * 20 + n(0.8)), doubleSupportPct: r1(b.ds * m("ds") + n(1)),
      stepAsymPct: r1(Math.max(0.4, b.asym * m("asym") + n(0.8))), stanceAsymPct: r1(Math.max(0.3, b.asym * 0.7 * m("asym") + n(0.6))),
      loadAsymPct: r1(Math.max(0.5, 4 + n(1.4))), strideLengthM: r2(stride), gaitSpeedMps: r2(speed),
      stepTimeMs: { left: Math.round(strideTime / 2 + n(6)), right: Math.round(strideTime / 2 + n(6)) },
      toeUpDeg: { left: r1(14.5 * (2 - m("cadence")) * 0.95 + n(1.1)), right: r1(13.8 * (2 - m("cadence")) * 0.95 + n(1.1)) },
      rollDeg: { left: r1(1.6 + n(0.9)), right: r1(-1.1 + n(0.9)) },
      strikePct: (() => { const heel = clampN(86 - (m("cadence") < 0.95 ? 9 : 0) + n(3), 55, 95); const mid = clampN(9 + n(2), 2, 30); const fore = clampN(100 - heel - mid - 1, 0, 30); return { heel: r1(heel), mid: r1(mid), fore: r1(fore), toe: r1(Math.max(0, 100 - heel - mid - fore)) }; })(),
      unsteadyMoments: unsteady,
    },
    balance: {
      windows: Math.round(14 + R() * 18), swayRmsMm: r1(sway), swayMlMm: r1(sway * 0.62), swayApMm: r1(sway * 0.78),
      swayAreaMm2: Math.round(sway * sway * 7.4), swayVelMmS: r1(sway * 1.75 + n(0.8)),
      weightLeftPct: r1(leftShare), toePct: r1(41 + n(2.5)),
    },
    transitions: { sitToStand: Math.round(26 + n(7)), failedRises: R() < 0.06 * m("rise") ? 1 : 0, riseTimeS: r2(rise), riseToWalkPauseS: r1(Math.max(0.3, 2.1 / m("rise") + n(0.4))) },
    events: { possibleFalls: 0, unsteady, help: 0, dizzy: R() < (e.dizzy ?? 0) ? 1 : 0 },
  };
}

function checkFor(date, score, R, profile) {
  const s = score / 100;
  const walkSpeed = r2(0.7 + 0.45 * s + (R() - 0.5) * 0.05);
  const results = {
    walk: { ok: true, variant: "single", courseM: 4, durationS: r2(4 / walkSpeed), speedMps: walkSpeed, steps: Math.round(7 + (1 - s) * 3), cadenceSpm: Math.round(92 + 14 * s), stepCvPct: r1(2 + (1 - s) * 5), doubleSupportPct: Math.round(22 + (1 - s) * 10) },
    talkWalk: { ok: true, variant: "dual", courseM: 4, speedMps: r2(walkSpeed * (0.86 - (1 - s) * 0.1)), durationS: r2(4 / (walkSpeed * (0.86 - (1 - s) * 0.1))), steps: 9, cadenceSpm: Math.round(86 + 12 * s) },
    balance: { ok: true, completed: s > 0.68 ? 3 : 2, stages: [
      { stage: "together", holdS: 10, swayRmsMm: r1(4 + (1 - s) * 3) },
      { stage: "semiTandem", holdS: 10, swayRmsMm: r1(5.5 + (1 - s) * 4) },
      { stage: "tandem", holdS: s > 0.68 ? 10 : r1(4 + s * 6), swayRmsMm: r1(8 + (1 - s) * 7) },
      ...(s > 0.68 ? [{ stage: "oneLeg", holdS: r1(2 + s * 5), swayRmsMm: r1(14 + (1 - s) * 8), liftedSide: "left" }] : []),
    ], stoppedAt: s > 0.68 ? null : "tandem" },
    chair: { ok: true, count: Math.round(6 + s * 9), repTimesS: [], fatiguePct: Math.round((1 - s) * 30) },
    tug: { ok: true, totalS: r2(15.5 - s * 7), riseS: r2(1.2 + (1 - s) * 0.8), steps: Math.round(14 + (1 - s) * 6) },
  };
  return results;
}

/** Full demo record for one persona: days, events, checks, profile. */
export function buildPersona(p, today = localToday()) {
  const R = rng(p.seed);
  const days = [];
  for (let k = p.days - 1; k >= 0; k--) {
    const date = addDays(today, -k);
    if (p.gapFromK != null && k <= p.gapFromK) continue;
    const d = synthDay(date, p.base, p.effect(k), R);
    if (k === 0) scaleToNow(d);
    days.push(d);
  }
  const events = (p.events ?? []).map((e, i) => {
    const at = new Date(`${addDays(today, -e.k)}T${String(e.hour).padStart(2, "0")}:${String(e.minute ?? 0).padStart(2, "0")}:00`);
    const d = days.find((x) => x.date === addDays(today, -e.k));
    if (d && e.kind === "possibleFall") d.events.possibleFalls++;
    if (d && e.kind === "dizzy") d.events.dizzy = Math.max(1, d.events.dizzy);
    return { id: `${p.id}-ev${i}`, kind: e.kind, at: at.toISOString(), detail: e.detail ?? {}, outcome: e.outcome ?? null, date: addDays(today, -e.k) };
  });
  const checks = [];
  if (p.checks) {
    for (let k = p.days - 3; k >= 0; k -= p.checks.every) {
      const eff = p.effect(k);
      const decline = eff ? Math.max(0, 1 - (eff.cadence ?? 1)) / 0.085 : 0;
      const score = Math.round(p.checks.baseScore - p.checks.drop * Math.min(1, decline) + (R() - 0.5) * 6);
      const date = addDays(today, -k);
      const results = checkFor(date, score, R, p);
      checks.push({ id: `${p.id}-chk${k}`, takenAt: new Date(`${date}T10:30:00`).toISOString(), score, results });
    }
  }
  return {
    profile: { userId: p.id, displayName: p.displayName, birthYear: p.birthYear, sex: p.sex, plan: p.plan, tags: p.tags ?? [], settings: {}, program: p.program ?? defaultProgram() },
    days, events, checks,
  };
}

/** Today's numbers reflect only the part of the day that has passed. */
function scaleToNow(d) {
  const now = new Date();
  const frac = clampN(((now.getHours() - 7) * 60 + now.getMinutes()) / (15 * 60), 0.08, 1);
  for (const k of Object.keys(d.minutes)) d.minutes[k] = r1(d.minutes[k] * frac);
  d.steps = Math.round(d.steps * frac);
  d.transitions.sitToStand = Math.round(d.transitions.sitToStand * frac);
}

export function defaultProgram() {
  return {
    checkEveryDays: 7,
    sensitivity: "standard",
    exercises: ["weightShift", "steadyStance", "heelRaise", "sitToStand", "marching"],
    riseAndPause: true,
  };
}

export function buildClinicPanel(today = localToday()) {
  const people = [buildPersona(PERSONAS.margaret, today)];
  CLINIC_PEOPLE.forEach(([name, by, sex, tags, story, seed]) => {
    const Rb = rng(seed * 7);
    const base = {
      cadence: 92 + Rb() * 18, cv: 2 + Rb() * 2.2, ds: 23 + Rb() * 7, sway: 5 + Rb() * 5, rise: 1.3 + Rb() * 0.9,
      walk: 22 + Rb() * 40, steps: 2400 + Rb() * 3800, speed: 0.75 + Rb() * 0.4, stride: 0.95 + Rb() * 0.3, asym: 2 + Rb() * 6, worn: 520 + Rb() * 200,
    };
    if (tags.includes("Parkinson's")) { base.cv += 1.8; base.stride -= 0.12; base.cadence += 6; }
    const p = {
      id: `demo-${name.toLowerCase().replace(/[^a-z]+/g, "-")}`, displayName: name, birthYear: by, sex, plan: "CLINIC", tags, seed,
      days: story === "learning" ? 5 : 84, base, effect: storyEffect(story),
      gapFromK: story === "nodata" ? 3 : null,
      events: story === "decline" ? [{ k: 2, kind: "possibleFall", hour: 18, minute: 40, outcome: "noResponse", detail: { impactG: 3.1, confidence: "higher" } }, { k: 6, kind: "dizzy", hour: 10, detail: { context: "turning" } }]
        : story === "watch" ? [{ k: 5, kind: "dizzy", hour: 14, detail: { context: "turning" } }] : [],
      checks: { every: 14, baseScore: 50 + Math.round(Rb() * 30), drop: story === "decline" ? 12 : story === "watch" ? 5 : 0 },
    };
    people.push(buildPersona(p, today));
  });
  return people;
}
