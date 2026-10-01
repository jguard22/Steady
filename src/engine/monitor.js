// Streaming everyday-life monitor.
//
// Feed it insole frames as they arrive; it keeps a running picture of the
// day: what the wearer is doing each second (sitting, standing, walking…),
// every walk long enough to measure, quiet-standing sway, sit-to-stand
// rises, unsteady moments, and possible falls. It never needs the cloud.
//
// Inputs (times are epoch ms; loads in any consistent unit, e.g. scaledSum):
//   pressure({t, side, load, cop?:{x,y} 0–1 heel→toe, regions?:{heel,mid,fore,toe}})
//   motion({t, side, accG?, pitchDeg?, rollDeg?, accWorld?:{x,y} m/s²})
//   step({t})            optional: firmware step-detector events
//   tick(t)              call about once a second so epochs close without data
//
// Everything that depends on body load is relative to W, the wearer's
// whole-body load on the insoles. W comes from a weigh-in (stand still for
// a few seconds), from walking (combined load averages W during a walk), or
// from a saved value.

import { analyzeBout, summarizeBouts, GAIT } from "./gait.js";
import { analyzeSway, pairCop } from "./sway.js";
import { median, percentile, round, mean } from "./stats.js";

export const ALGO_VERSION = 1;

export const CFG = {
  epochMs: 1000,
  contactOnFrac: 0.45,     // of the per-foot load envelope (hardware-calibrated hysteresis)
  contactOffFrac: 0.30,
  envelopeHalfLifeMs: 30000,
  envelopeFloorFrac: 0.35, // of W, once W is known, so thresholds never collapse while seated
  boutGapMs: 2000,
  standFrac: 0.55,         // combined load / W
  sitFrac: 0.40,
  unloadedFrac: 0.04,
  raisedFootFrac: 0.02,
  notWornAfterS: 600,      // unloaded this long = insoles not being worn
  swayMinS: 10,
  swayMaxS: 30,
  riseFromFrac: 0.35,
  riseToFrac: 0.85,
  riseHoldMs: 400,
  riseFailMs: 3000,
  sitHoldMs: 1500,
  firstStepWindowMs: 15000,
  fallUprightWindowMs: 800,
  fallDropFrac: 0.08,
  fallConfirmMs: 12000,
  fallImpactG: 2.2,
  weighInMs: 3000,
  strikeWindowMs: 60,
};

export function dayKeyOf(t, tzOffsetMin = new Date(t).getTimezoneOffset()) {
  const d = new Date(t - tzOffsetMin * 60000);
  return d.toISOString().slice(0, 10);
}

function newDay(key) {
  return {
    date: key,
    sec: { walk: 0, run: 0, stand: 0, standLeft: 0, standRight: 0, sit: 0, sitLeftRaised: 0, sitRightRaised: 0, unloaded: 0, notWorn: 0, noData: 0 },
    steps: 0,
    bouts: [],
    sway: [],
    weight: { leftShare: [], toeShare: [] },
    rises: [], failedRises: 0, pauses: [],
    events: { possibleFalls: 0, unsteady: 0, help: 0, dizzy: 0 },
    firstT: null, lastT: null,
  };
}

/**
 * @param {{refLoad?:number, onEvent?:(type:string, data:any)=>void, cfg?:Partial<typeof CFG>, tzOffsetMin?:number}} opts
 */
export function createMonitor(opts = {}) {
  const C = { ...CFG, ...(opts.cfg ?? {}) };
  const emit = opts.onEvent ?? (() => {});
  const tz = opts.tzOffsetMin;

  const S = {
    W: opts.refLoad ?? null,
    wSource: opts.refLoad ? "saved" : null,
    side: {
      left: newSide(), right: newSide(),
    },
    // epoch accumulator
    epochStart: null,
    ep: freshEpoch(),
    lastClass: "sit",
    unloadedStreak: 0,
    // bout
    bout: null,
    lastOn: null,
    // standing window
    stand: null,
    // transitions
    cSmooth: null, cT: null,
    seatedSince: null, rise: null, awaitingStep: null,
    lastUprightT: null,
    fall: null,
    weighIn: null,
    day: null,
    days: new Map(),
    live: { activity: "unknown", cadence: null, boutSteps: 0, cop: null, loads: { left: 0, right: 0 } },
    recentSteps: [],
  };

  function newSide() {
    return { load: 0, t: 0, env: null, loaded: false, lastEdge: 0, cop: null, regions: null, contact: null, motion: null, standPitch: [], swing: null };
  }
  function freshEpoch() {
    return { n: 0, sumL: 0, sumR: 0, edges: 0, validSteps: 0, flight: false };
  }

  function dayFor(t) {
    const key = dayKeyOf(t, tz);
    if (!S.day || S.day.date !== key) {
      if (S.day) finishDay();
      S.day = S.days.get(key) ?? newDay(key);
      S.days.set(key, S.day);
    }
    S.day.firstT ??= t;
    S.day.lastT = t;
    return S.day;
  }
  function finishDay() {
    if (S.bout) closeBout(S.day.lastT ?? 0);
    emit("day", summarizeDay(S.day));
  }

  // ---------- pressure ----------
  function pressure(f) {
    const sd = S.side[f.side];
    if (!sd) return;
    const t = f.t;
    rollEpochs(t);
    dayFor(t);
    sd.load = Math.max(0, f.load);
    sd.t = t;
    sd.cop = f.cop ?? sd.cop;
    sd.regions = f.regions ?? null;

    // per-foot envelope: fast attack, slow decay, floored by W
    const decay = sd.env == null ? 0 : Math.pow(0.5, (t - (sd.envT ?? t)) / C.envelopeHalfLifeMs);
    sd.env = Math.max(sd.load, (sd.env ?? sd.load) * decay, S.W ? S.W * C.envelopeFloorFrac : 0);
    sd.envT = t;

    // weigh-in
    if (S.weighIn && t <= S.weighIn.until) S.weighIn.samples.push(combined());
    else if (S.weighIn) finishWeighIn();

    contactUpdate(f.side, t);
    if (sd.contact && t - sd.contact.on <= C.strikeWindowMs && sd.regions) {
      for (const r of ["heel", "mid", "fore", "toe"]) sd.contact.regionAcc[r] += sd.regions[r] ?? 0;
    }
    if (sd.contact) sd.contact.peak = Math.max(sd.contact.peak, sd.load);

    // epoch sums (one sample per side update)
    if (f.side === "left") { S.ep.sumL += sd.load; } else { S.ep.sumR += sd.load; }
    S.ep.n += 0.5;

    const other = S.side[f.side === "left" ? "right" : "left"];
    if (t - other.t < 200) bothSides(t);
  }

  function combined() {
    return S.side.left.load + S.side.right.load;
  }

  function contactUpdate(side, t) {
    const sd = S.side[side];
    if (!sd.env || sd.env <= 0) return;
    const on = sd.env * C.contactOnFrac;
    const off = sd.env * C.contactOffFrac;
    if (!sd.loaded && sd.load >= on && t - sd.lastEdge > 60) {
      sd.loaded = true; sd.lastEdge = t;
      onContact(side, t);
    } else if (sd.loaded && sd.load <= off && t - sd.lastEdge > 60) {
      sd.loaded = false; sd.lastEdge = t;
      offContact(side, t);
    }
  }

  function onContact(side, t) {
    const sd = S.side[side];
    S.ep.edges++;
    const m = sd.motion;
    const standPitch = median(sd.standPitch) ?? 0;
    sd.contact = {
      side, on: t, off: null, peak: sd.load,
      regionAcc: { heel: 0, mid: 0, fore: 0, toe: 0 },
      toeUpDeg: m?.pitchDeg != null && t - m.t < 100 ? round(m.pitchDeg - standPitch, 1) : undefined,
      rollDeg: m?.rollDeg != null && t - m.t < 100 ? round(m.rollDeg, 1) : undefined,
      strideLengthM: finishSwing(side, t),
    };
    // valid alternating step?
    const prev = S.lastOn;
    const dt = prev ? t - prev.t : Infinity;
    const alternating = prev && prev.side !== side && dt >= GAIT.minStepMs && dt <= GAIT.maxStepMs;
    if (alternating) {
      S.ep.validSteps++;
      S.day.steps++;
      S.recentSteps.push(t);
      if (!S.bout) S.bout = { contacts: [], start: prev.t };
      if (S.awaitingStep) {
        S.day.pauses.push(round((prev.t - S.awaitingStep) / 1000, 1));
        S.awaitingStep = null;
      }
    } else if (S.bout && dt > C.boutGapMs) {
      closeBout(prev?.t ?? t);
    }
    S.lastOn = { side, t };
  }

  function offContact(side, t) {
    const sd = S.side[side];
    const c = sd.contact;
    if (!c) return;
    c.off = t;
    const r = c.regionAcc;
    const tot = r.heel + r.mid + r.fore + r.toe;
    c.strike = tot > 0 ? Object.entries(r).sort((a, b) => b[1] - a[1])[0][0] : undefined;
    delete c.regionAcc;
    if (S.bout) S.bout.contacts.push(c);
    sd.contact = null;
    sd.swing = sd.motion?.accWorld ? { t0: t, last: t, vx: 0, vy: 0, samples: [] } : null;
    // flight: both feet off at once during a walk/run
    const other = S.side[side === "left" ? "right" : "left"];
    if (S.bout && !other.loaded) S.ep.flight = true;
  }

  // ZUPT stride length: integrate horizontal acceleration through the swing,
  // remove linear velocity drift (the foot is still at both ends).
  function finishSwing(side, tOn) {
    const sw = S.side[side].swing;
    S.side[side].swing = null;
    if (!sw || sw.samples.length < 5) return undefined;
    const T = tOn - sw.t0;
    if (T < 200 || T > 1500) return undefined;
    let vx = 0, vy = 0, px = 0, py = 0, prevT = sw.t0;
    const vel = [];
    for (const s of sw.samples) {
      const dt = (s.t - prevT) / 1000;
      vx += s.ax * dt; vy += s.ay * dt;
      vel.push({ t: s.t, vx, vy });
      prevT = s.t;
    }
    const endV = vel[vel.length - 1];
    prevT = sw.t0;
    for (const v of vel) {
      const frac = (v.t - sw.t0) / T;
      const cx = v.vx - endV.vx * frac;
      const cy = v.vy - endV.vy * frac;
      const dt = (v.t - prevT) / 1000;
      px += cx * dt; py += cy * dt;
      prevT = v.t;
    }
    return round(Math.hypot(px, py), 3);
  }

  function closeBout(tEnd) {
    const b = S.bout;
    S.bout = null;
    if (!b) return;
    // include contacts still open at the end
    const res = analyzeBout(b.contacts);
    if (res) {
      S.day.bouts.push(res);
      S.day.events.unsteady += res.unsteadyMoments.length;
      for (const tm of res.unsteadyMoments) emit("unsteady", { t: tm });
      if (S.W == null || S.wSource === "walk" || S.wSource === "guess") learnWFromWalk(b);
      emit("bout", res);
    }
    S.live.boutSteps = 0;
  }

  function learnWFromWalk(b) {
    const loads = b.contacts.map((c) => c.peak).filter((x) => x > 0);
    if (loads.length < 6) return;
    // single-support peak load ≈ 1.05–1.1 × body load on the insoles
    const w = median(loads) / 1.07;
    if (!S.W || S.wSource === "guess") { S.W = w; S.wSource = "walk"; emit("calibrated", { W: S.W, source: "walk" }); return; }
    if (w > S.W * 0.5 && w < S.W * 2) {
      S.W = S.W * 0.8 + w * 0.2;
      if (S.wSource !== "walk") { S.wSource = "walk"; }
    }
  }

  // ---------- both sides fresh: transitions, falls, sway ----------
  function bothSides(t) {
    if (!S.W) {
      // until W is known, guess from the busiest recent combined load
      S.guess ??= [];
      S.guess.push(combined());
      if (S.guess.length > 3000) S.guess.splice(0, 1000);
      if (S.guess.length >= 250) { S.W = percentile(S.guess, 90); S.wSource = "guess"; }
      else return;
    }
    const c = combined() / S.W;
    const alpha = 0.3;
    S.cSmooth = S.cSmooth == null ? c : S.cSmooth + alpha * (c - S.cSmooth);
    const cs = S.cSmooth;
    const { left: L, right: R } = S.side;
    S.live.loads = { left: L.load / S.W, right: R.load / S.W };
    const cop = pairCop(L.load, L.cop, R.load, R.cop);
    S.live.cop = cop;

    if (cs >= 0.6) S.lastUprightT = t;

    // sit-to-stand
    if (cs < C.riseFromFrac) {
      S.seatedSince ??= t;
      if (S.rise && !S.rise.done && t - S.rise.start < C.riseFailMs && cs < C.riseFromFrac - 0.05) {
        S.day.failedRises++;
        emit("riseAttempt", { t });
        S.rise = null;
      }
    } else if (S.seatedSince != null && t - S.seatedSince >= C.sitHoldMs && !S.rise) {
      S.rise = { start: t, reachedAt: null, done: false };
    }
    if (cs >= C.riseFromFrac && !S.rise) S.seatedSince = null;
    if (S.rise && !S.rise.done) {
      if (cs >= C.riseToFrac) {
        S.rise.reachedAt ??= t;
        if (t - S.rise.reachedAt >= C.riseHoldMs) {
          const riseS = (S.rise.reachedAt - S.rise.start) / 1000;
          S.rise.done = true;
          if (riseS > 0.2 && riseS < 8) {
            S.day.rises.push(round(riseS, 2));
            S.awaitingStep = S.rise.reachedAt;
            emit("stood", { t: S.rise.reachedAt, riseS: round(riseS, 2) });
          }
          S.seatedSince = null;
          S.rise = null;
        }
      } else {
        S.rise.reachedAt = null;
        if (t - S.rise.start > C.riseFailMs * 2) S.rise = null;
      }
    }
    if (S.awaitingStep && t - S.awaitingStep > C.firstStepWindowMs) S.awaitingStep = null;

    // possible fall: abrupt loss of all load from upright, then nothing
    if (!S.fall && cs < C.fallDropFrac && S.lastUprightT && t - S.lastUprightT < C.fallUprightWindowMs) {
      S.fall = { t, impactG: maxRecentAcc(t, 1000) };
    }
    if (S.fall) {
      if (c > C.fallDropFrac * 2 || (S.lastOn && S.lastOn.t > S.fall.t + 500)) S.fall = null;
      else if (t - S.fall.t >= C.fallConfirmMs) {
        const impact = Math.max(S.fall.impactG ?? 0, maxRecentAcc(S.fall.t + 1500, 2500) ?? 0);
        S.day.events.possibleFalls++;
        emit("possibleFall", { t: S.fall.t, impactG: impact ? round(impact, 2) : null, confidence: impact >= C.fallImpactG ? "higher" : "lower" });
        S.fall = null;
        S.lastUprightT = null;
      }
    }

    // quiet standing window (bipedal, no steps)
    const quiet = cs >= 0.7 && L.load >= 0.2 * S.W && R.load >= 0.2 * S.W && !S.bout && (!S.lastOn || t - S.lastOn.t > 1500);
    if (quiet && cop) {
      S.stand ??= { t0: t, pts: [] };
      S.stand.pts.push({ t, x: cop.x, y: cop.y, ls: L.load / (L.load + R.load), toe: toeShare() });
      if (t - S.stand.t0 >= C.swayMaxS * 1000) closeStand();
    } else if (S.stand) closeStand();

    if (L.motion?.pitchDeg != null && quiet) pushPitch("left");
    if (R.motion?.pitchDeg != null && quiet) pushPitch("right");
  }

  function pushPitch(side) {
    const a = S.side[side].standPitch;
    a.push(S.side[side].motion.pitchDeg);
    if (a.length > 400) a.splice(0, 200);
  }

  function toeShare() {
    const shares = [];
    for (const side of ["left", "right"]) {
      const sd = S.side[side];
      if (sd.regions) {
        const r = sd.regions;
        const tot = r.heel + r.mid + r.fore + r.toe;
        if (tot > 0) shares.push((r.fore + r.toe) / tot);
      } else if (sd.cop) shares.push(sd.cop.y);
    }
    return shares.length ? mean(shares) : null;
  }

  function closeStand() {
    const w = S.stand;
    S.stand = null;
    if (!w) return;
    const durS = (w.pts[w.pts.length - 1].t - w.t0) / 1000;
    if (durS < C.swayMinS) return;
    // middle of the window: settle-in and step-off excluded
    const pts = w.pts.filter((p) => p.t >= w.t0 + 2000 && p.t <= w.pts[w.pts.length - 1].t - 1000);
    const res = analyzeSway(pts);
    if (!res) return;
    S.day.sway.push(res);
    S.day.weight.leftShare.push(mean(pts.map((p) => p.ls)));
    const toes = pts.map((p) => p.toe).filter((x) => x != null);
    if (toes.length) S.day.weight.toeShare.push(mean(toes));
    emit("sway", res);
  }

  // ---------- motion ----------
  const accLog = [];
  function maxRecentAcc(tEnd, windowMs) {
    let m = null;
    for (const a of accLog) if (a.t >= tEnd - windowMs && a.t <= tEnd) m = Math.max(m ?? 0, a.g);
    return m;
  }
  function motion(f) {
    const sd = S.side[f.side];
    if (!sd) return;
    sd.motion = { ...f };
    if (f.accG != null) {
      accLog.push({ t: f.t, g: f.accG });
      while (accLog.length && f.t - accLog[0].t > 5000) accLog.shift();
    }
    if (sd.swing && f.accWorld) {
      sd.swing.samples.push({ t: f.t, ax: f.accWorld.x, ay: f.accWorld.y });
      if (sd.swing.samples.length > 200) sd.swing = null;
    }
  }

  function step(f) {
    // Firmware step events confirm walking; they also unlock W learning
    // when pressure-only detection hasn't had a reference yet.
    S.fwSteps = (S.fwSteps ?? 0) + 1;
    S.lastFwStep = f.t;
  }

  // ---------- epochs ----------
  function rollEpochs(t) {
    if (S.epochStart == null) { S.epochStart = Math.floor(t / C.epochMs) * C.epochMs; return; }
    while (t >= S.epochStart + C.epochMs) {
      closeEpoch(S.epochStart);
      S.epochStart += C.epochMs;
      // avoid spinning over long gaps: jump, counting the gap as no data
      if (t - S.epochStart > 3600_000) {
        const gap = Math.floor((t - S.epochStart) / C.epochMs);
        S.epochStart += gap * C.epochMs;
      }
    }
  }

  function closeEpoch(tEpoch) {
    const e = S.ep;
    S.ep = freshEpoch();
    const day = dayFor(tEpoch);
    const sec = C.epochMs / 1000;
    let cls;
    if (e.n < 1) cls = "noData";
    else if (e.validSteps > 0 || (S.bout && tEpoch - (S.lastOn?.t ?? 0) < C.boutGapMs)) cls = e.flight ? "run" : "walk";
    else if (!S.W) cls = "noData";
    else {
      const mL = e.sumL / e.n, mR = e.sumR / e.n;
      const c = (mL + mR) / S.W;
      if (c >= C.standFrac) {
        const share = mL / (mL + mR);
        cls = share > 0.65 ? "standLeft" : share < 0.35 ? "standRight" : "stand";
      } else if (c < C.unloadedFrac) cls = "unloaded";
      else if (c < C.sitFrac || S.lastClass.startsWith("sit") || S.lastClass === "unloaded") {
        if (mL < C.raisedFootFrac * S.W && mR >= C.raisedFootFrac * S.W) cls = "sitLeftRaised";
        else if (mR < C.raisedFootFrac * S.W && mL >= C.raisedFootFrac * S.W) cls = "sitRightRaised";
        else cls = "sit";
      } else cls = S.lastClass.startsWith("stand") ? S.lastClass : "stand";
    }
    if (cls === "unloaded") {
      S.unloadedStreak++;
      if (S.unloadedStreak === C.notWornAfterS) { day.sec.unloaded -= (C.notWornAfterS - 1) * sec; day.sec.notWorn += (C.notWornAfterS - 1) * sec; }
      if (S.unloadedStreak >= C.notWornAfterS) cls = "notWorn";
    } else S.unloadedStreak = 0;
    day.sec[cls] = Math.max(0, (day.sec[cls] ?? 0) + sec);
    S.lastClass = cls;
    S.live.activity = cls;
    // live cadence over the last 10 s of valid steps
    S.recentSteps = S.recentSteps.filter((x) => tEpoch - x < 10000);
    S.live.cadence = S.recentSteps.length >= 4 ? round((S.recentSteps.length - 1) / ((S.recentSteps[S.recentSteps.length - 1] - S.recentSteps[0]) / 60000), 0) : null;
  }

  function tick(t) {
    rollEpochs(t);
    if (S.bout && S.lastOn && t - S.lastOn.t > C.boutGapMs) closeBout(S.lastOn.t);
    if (S.weighIn && t > S.weighIn.until) finishWeighIn();
  }

  // ---------- weigh-in ----------
  function startWeighIn(t) {
    S.weighIn = { until: t + C.weighInMs, samples: [] };
  }
  function finishWeighIn() {
    const w = S.weighIn;
    S.weighIn = null;
    if (!w || w.samples.length < 20) { emit("weighIn", { ok: false }); return; }
    const m = median(w.samples);
    const spread = (percentile(w.samples, 90) - percentile(w.samples, 10)) / m;
    if (m <= 0 || spread > 0.35) { emit("weighIn", { ok: false, reason: "moving" }); return; }
    S.W = m; S.wSource = "weighIn";
    emit("weighIn", { ok: true, W: m });
    emit("calibrated", { W: m, source: "weighIn" });
  }

  // ---------- user-reported ----------
  function note(kind, t) {
    const day = dayFor(t);
    if (kind === "help") day.events.help++;
    if (kind === "dizzy") day.events.dizzy++;
  }

  return {
    pressure, motion, step, tick, note,
    startWeighIn,
    get W() { return S.W; },
    get wSource() { return S.wSource; },
    live: () => ({ ...S.live, W: S.W, wSource: S.wSource, standing: !!S.stand, inWalk: !!S.bout }),
    today: () => (S.day ? summarizeDay(S.day) : null),
    days: () => [...S.days.values()].map(summarizeDay),
    flush(t) { tick(t); if (S.bout) closeBout(S.lastOn?.t ?? t); if (S.stand) closeStand(); return S.day ? summarizeDay(S.day) : null; },
    /** Raw accumulators for today, to persist across app restarts. */
    rawToday: () => (S.day ? structuredClone(S.day) : null),
    /** Put back saved accumulators (same day only). */
    restoreDay(raw) {
      if (!raw?.date) return false;
      S.days.set(raw.date, raw);
      if (!S.day || S.day.date === raw.date) S.day = raw;
      return true;
    },
    _state: S,
  };
}

/** Turn a day's raw accumulators into the stored/sent summary. */
export function summarizeDay(d) {
  const min = (s) => round((s ?? 0) / 60, 1);
  const gait = summarizeBouts(d.bouts);
  const sway = d.sway.filter(Boolean);
  const pick = (k) => round(median(sway.map((s) => s[k]).filter((x) => x != null)), 1);
  const s = d.sec;
  const worn = s.walk + s.run + s.stand + s.standLeft + s.standRight + s.sit + s.sitLeftRaised + s.sitRightRaised + s.unloaded;
  return {
    date: d.date,
    algo: ALGO_VERSION,
    minutes: {
      worn: min(worn),
      walk: min(s.walk), run: min(s.run),
      stand: min(s.stand + s.standLeft + s.standRight), standLeft: min(s.standLeft), standRight: min(s.standRight),
      sit: min(s.sit + s.sitLeftRaised + s.sitRightRaised), sitLeftRaised: min(s.sitLeftRaised), sitRightRaised: min(s.sitRightRaised),
      unloaded: min(s.unloaded),
    },
    steps: d.steps,
    gait,
    balance: sway.length ? {
      windows: sway.length,
      swayRmsMm: pick("rmsMm"), swayMlMm: pick("rmsMlMm"), swayApMm: pick("rmsApMm"),
      swayAreaMm2: pick("areaMm2"), swayVelMmS: pick("velocityMmS"),
      weightLeftPct: round(median(d.weight.leftShare) * 100, 1),
      toePct: d.weight.toeShare.length ? round(median(d.weight.toeShare) * 100, 1) : null,
    } : null,
    transitions: {
      sitToStand: d.rises.length,
      failedRises: d.failedRises,
      riseTimeS: round(median(d.rises), 2),
      riseToWalkPauseS: round(median(d.pauses), 1),
    },
    events: { ...d.events },
  };
}
