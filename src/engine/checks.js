// Steady Check: short guided tests done at home, measured by the insoles.
//
// The four tests are the familiar ones balance specialists use —
// 4-metre walk, 4-stage balance, 30-second chair stand, Timed Up & Go —
// plus "Talk & Walk": the same walk while counting backwards, to see how
// much walking changes when the mind is busy.
//
// Each runner is a small state machine fed with the same frames as the
// monitor. Loads are relative to W (whole-body load), so W must be known
// (a weigh-in starts every check).

import { analyzeSway, pairCop } from "./sway.js";
import { cvPct, mean, round } from "./stats.js";

export const CHECK = {
  footOn: 0.40,
  footOff: 0.25,
  walkQuietMs: 1400,
  walkTimeoutMs: 40000,
  stageMs: 10000,
  stageLossFrac: 0.12,
  chairMs: 30000,
  chairUp: 0.85,
  chairDown: 0.45,
  tugRise: 0.85,
  tugSit: 0.5,
  tugSitHoldMs: 700,
  tugMaxMs: 60000,
};

export const STAGES = [
  { key: "together", label: "Feet side by side" },
  { key: "semiTandem", label: "Instep of one foot touching the big toe of the other" },
  { key: "tandem", label: "One foot in front of the other, heel touching toe" },
  { key: "oneLeg", label: "Stand on one foot" },
];

function base(W) {
  const S = { W, L: 0, R: 0, copL: null, copR: null, tL: 0, tR: 0, loaded: { left: true, right: true }, edges: [], samples: [] };
  S.c = () => (S.L + S.R) / S.W;
  S.feed = (f) => {
    if (f.side === "left") { S.L = f.load; S.copL = f.cop ?? S.copL; S.tL = f.t; }
    else { S.R = f.load; S.copR = f.cop ?? S.copR; S.tR = f.t; }
    const v = f.side === "left" ? S.L : S.R;
    let edge = null;
    if (S.loaded[f.side] && v <= S.W * CHECK.footOff) { S.loaded[f.side] = false; edge = "off"; }
    else if (!S.loaded[f.side] && v >= S.W * CHECK.footOn) { S.loaded[f.side] = true; edge = "on"; }
    if (edge) S.edges.push({ t: f.t, side: f.side, edge });
    S.samples.push({ t: f.t, c: S.c(), bl: S.loaded.left, br: S.loaded.right });
    return edge;
  };
  S.cop = () => pairCop(S.L, S.copL, S.R, S.copR);
  return S;
}

/** 4-metre (or any course) walk at the usual pace. variant 'dual' = Talk & Walk. */
export function walkTest({ W, courseM = 4, variant = "single", onUpdate = () => {} }) {
  const S = base(W);
  let t0 = null, moveAt = null, lastEdgeAt = null, result = null;
  return {
    kind: variant === "dual" ? "talkWalk" : "walk",
    start(t) { t0 = t; },
    pressure(f) {
      if (result || t0 == null) return;
      const e = S.feed(f);
      if (e === "off" && moveAt == null) { moveAt = f.t; onUpdate({ phase: "walking" }); }
      if (e) lastEdgeAt = f.t;
    },
    tick(t) {
      if (result || t0 == null) return result;
      const contacts = S.edges.filter((e) => e.edge === "on" && moveAt != null && e.t > moveAt);
      if (moveAt && contacts.length >= 3 && t - lastEdgeAt > CHECK.walkQuietMs && S.loaded.left && S.loaded.right) {
        result = finish(contacts);
      } else if (t - t0 > CHECK.walkTimeoutMs) result = { ok: false, reason: moveAt ? "didNotStop" : "noMovement" };
      return result;
    },
    get result() { return result; },
  };
  function finish(contacts) {
    const endAt = contacts[contacts.length - 1].t;
    const durS = (endAt - moveAt) / 1000;
    const gaps = [];
    for (let i = 1; i < contacts.length; i++) gaps.push(contacts[i].t - contacts[i - 1].t);
    const span = S.samples.filter((s) => s.t >= moveAt && s.t <= endAt);
    const ds = span.length ? span.filter((s) => s.bl && s.br).length / span.length : null;
    return {
      ok: durS > 0.5,
      variant,
      courseM,
      durationS: round(durS, 2),
      speedMps: round(courseM / durS, 2),
      steps: contacts.length,
      cadenceSpm: gaps.length ? round(60000 / mean(gaps), 0) : null,
      stepCvPct: gaps.length > 2 ? round(cvPct(gaps), 1) : null,
      doubleSupportPct: ds != null ? round(ds * 100, 0) : null,
    };
  }
}

/** CDC-style 4-stage balance: 10 s per stance, stop at the first stance not held. */
export function balanceTest({ W, onUpdate = () => {} }) {
  const S = base(W);
  let stage = 0, stageT0 = null, pts = [], lifted = null, liftT = null, result = null;
  const out = [];
  function endStage(t, held) {
    const sway = analyzeSway(pts);
    out.push({ stage: STAGES[stage].key, holdS: round(held / 1000, 1), swayRmsMm: sway?.rmsMm ?? null, swayAreaMm2: sway?.areaMm2 ?? null, liftedSide: stage === 3 ? lifted : undefined });
    const failed = held < CHECK.stageMs - 250;
    stage++;
    pts = []; lifted = null; liftT = null;
    if (failed || stage >= STAGES.length) {
      result = { ok: true, stages: out, completed: out.filter((s) => s.holdS >= 9.75).length, stoppedAt: failed ? out[out.length - 1].stage : null };
      onUpdate({ phase: "done" });
    } else {
      stageT0 = t;
      onUpdate({ phase: "stage", stage, label: STAGES[stage].label });
    }
  }
  return {
    kind: "balance",
    start(t) { stageT0 = t; onUpdate({ phase: "stage", stage: 0, label: STAGES[0].label }); },
    pressure(f) {
      if (result || stageT0 == null) return;
      S.feed(f);
      const t = f.t;
      const cop = S.cop();
      if (cop) pts.push({ t, x: cop.x, y: cop.y });
      if (stage < 3) {
        // a foot coming off the ground (a step to catch balance) ends the stance
        const lossL = S.L < S.W * CHECK.stageLossFrac, lossR = S.R < S.W * CHECK.stageLossFrac;
        if ((lossL || lossR) && t - stageT0 > 800) endStage(t, t - stageT0);
      } else {
        if (!lifted) {
          if (S.L < S.W * CHECK.stageLossFrac) { lifted = "left"; liftT = t; }
          else if (S.R < S.W * CHECK.stageLossFrac) { lifted = "right"; liftT = t; }
        } else if ((lifted === "left" ? S.L : S.R) > S.W * CHECK.footOff && t - liftT > 300) {
          endStage(t, t - liftT);
        }
      }
    },
    tick(t) {
      if (result || stageT0 == null) return result;
      const el = t - (stage === 3 && liftT ? liftT : stageT0);
      onUpdate({ phase: "progress", stage, elapsedMs: Math.min(CHECK.stageMs, el) });
      if (stage === 3 && !lifted && t - stageT0 > 6000) endStage(t, 0);
      else if (el >= CHECK.stageMs) endStage(t, CHECK.stageMs);
      return result;
    },
    get result() { return result; },
  };
}

/** 30-second chair stand: full stands counted from the load rising past standing. */
export function chairStandTest({ W, onUpdate = () => {} }) {
  const S = base(W);
  let t0 = null, up = false, count = 0, result = null;
  const reps = [];
  return {
    kind: "chair",
    start(t) { t0 = t; up = S.c() > CHECK.chairUp; },
    pressure(f) {
      if (result || t0 == null) return;
      S.feed(f);
      const c = S.c();
      if (!up && c > CHECK.chairUp) { up = true; count++; reps.push(f.t - t0); onUpdate({ phase: "count", count }); }
      else if (up && c < CHECK.chairDown) up = false;
    },
    tick(t) {
      if (result || t0 == null) return result;
      const left = Math.max(0, CHECK.chairMs - (t - t0));
      onUpdate({ phase: "progress", leftMs: left, count });
      if (left <= 0) {
        // a stand that started but didn't finish in time doesn't count; the
        // up-edge already requires the load to pass standing.
        const gaps = reps.slice(1).map((r, i) => r - reps[i]);
        result = { ok: true, count, repTimesS: reps.map((r) => round(r / 1000, 1)), fatiguePct: gaps.length >= 4 ? round(((mean(gaps.slice(-2)) - mean(gaps.slice(0, 2))) / mean(gaps.slice(0, 2))) * 100, 0) : null };
      }
      return result;
    },
    get result() { return result; },
  };
}

/** Timed Up & Go: stand, walk 3 m, turn, walk back, sit. */
export function tugTest({ W, onUpdate = () => {} }) {
  const S = base(W);
  let t0 = null, riseAt = null, firstStepAt = null, belowSince = null, satAt = null, result = null;
  return {
    kind: "tug",
    start(t) { t0 = t; },
    pressure(f) {
      if (result || t0 == null) return;
      const e = S.feed(f);
      const c = S.c();
      const t = f.t;
      if (riseAt == null) { if (c > CHECK.tugRise) { riseAt = t; onUpdate({ phase: "up" }); } return; }
      if (e === "on" && firstStepAt == null && t - riseAt > 200) firstStepAt = t;
      if (firstStepAt && t - firstStepAt > 2000) {
        if (c < CHECK.tugSit) { belowSince ??= t; if (t - belowSince > CHECK.tugSitHoldMs) satAt = belowSince; }
        else belowSince = null;
      }
    },
    tick(t) {
      if (result || t0 == null) return result;
      if (satAt) {
        const steps = S.edges.filter((e) => e.edge === "on" && e.t >= (firstStepAt ?? 0) - 50 && e.t < satAt).length;
        result = { ok: true, totalS: round((satAt - t0) / 1000, 2), riseS: firstStepAt && riseAt ? round((firstStepAt - riseAt) / 1000, 2) : null, steps };
      } else if (t - t0 > CHECK.tugMaxMs) result = { ok: false, reason: "timeout" };
      return result;
    },
    get result() { return result; },
  };
}

// ---------- scoring & references ----------

// CDC STEADI 30-Second Chair Stand: scores below these are "below average"
// for age/sex. Shown to clinicians as a published reference only.
const CHAIR_BELOW = [
  [60, 64, 14, 12], [65, 69, 12, 11], [70, 74, 12, 10], [75, 79, 11, 10],
  [80, 84, 10, 9], [85, 89, 8, 8], [90, 94, 7, 4],
];

export function chairReference(age, sex) {
  if (!age) return null;
  const row = CHAIR_BELOW.find(([a, b]) => age >= a && age <= b) ?? (age > 94 ? CHAIR_BELOW[CHAIR_BELOW.length - 1] : null);
  if (!row) return null;
  if (sex === "male") return row[2];
  if (sex === "female") return row[3];
  return Math.round((row[2] + row[3]) / 2);
}

/**
 * Combine one sitting of tests into a 0–100 Steady Check score and the
 * clinician-facing references. The score is for tracking change in the same
 * person; it is not a clinical scale.
 */
export function summarizeCheck(r, profile = {}) {
  const comps = [];
  if (r.walk?.ok) comps.push({ key: "walk", label: "Walking speed", value: r.walk.speedMps, unit: "m/s", norm: Math.min(1, r.walk.speedMps / 1.2) });
  if (r.balance?.ok) {
    const tandem = r.balance.stages.find((s) => s.stage === "tandem");
    const one = r.balance.stages.find((s) => s.stage === "oneLeg");
    const holdScore = (r.balance.completed + Math.min(1, (one?.holdS ?? 0) / 10)) / 4;
    const swayPenalty = tandem?.swayRmsMm ? Math.min(1, 10 / Math.max(5, tandem.swayRmsMm)) : 1;
    comps.push({ key: "balance", label: "Balance", value: r.balance.completed, unit: "of 4 stances", norm: holdScore * (0.7 + 0.3 * swayPenalty) });
  }
  if (r.chair?.ok) comps.push({ key: "chair", label: "Leg strength", value: r.chair.count, unit: "stands", norm: Math.min(1, r.chair.count / 15) });
  if (r.tug?.ok) comps.push({ key: "tug", label: "Up & go", value: r.tug.totalS, unit: "s", norm: Math.min(1, 9 / Math.max(6, r.tug.totalS)) });
  const score = comps.length ? Math.round((comps.reduce((a, c) => a + c.norm, 0) / comps.length) * 100) : null;

  const refs = [];
  if (r.tug?.ok) refs.push({ key: "tug", text: "Timed Up & Go of 12 s or longer", source: "CDC STEADI", met: r.tug.totalS >= 12, value: `${r.tug.totalS} s` });
  const chairRef = chairReference(profile.age, profile.sex);
  if (r.chair?.ok && chairRef != null) refs.push({ key: "chair", text: `Fewer than ${chairRef} stands in 30 s for age${profile.sex ? "/sex" : ""}`, source: "CDC STEADI", met: r.chair.count < chairRef, value: `${r.chair.count}` });
  if (r.balance?.ok) {
    const tandem = r.balance.stages.find((s) => s.stage === "tandem");
    refs.push({ key: "balance", text: "Can't hold tandem stance for 10 s", source: "CDC STEADI", met: !tandem || tandem.holdS < 10, value: tandem ? `${tandem.holdS} s` : "not reached" });
  }
  if (r.walk?.ok) refs.push({ key: "walk", text: "Usual walking speed below 1.0 m/s", source: "Published gait-speed reference", met: r.walk.speedMps < 1.0, value: `${r.walk.speedMps} m/s` });
  let dualTaskCostPct = null;
  if (r.walk?.ok && r.talkWalk?.ok) dualTaskCostPct = round(((r.walk.speedMps - r.talkWalk.speedMps) / r.walk.speedMps) * 100, 0);
  return { score, components: comps, references: refs, dualTaskCostPct };
}

