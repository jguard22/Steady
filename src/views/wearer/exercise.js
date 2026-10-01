// Exercise player: balance practice with live insole feedback.
import { html, svg, nothing } from "../../../vendor/lit.js";
import { state, update, invalidate, go } from "../../app/state.js";
import { senseService } from "../../app/sense-service.js";
import { icon } from "../../ui/icons.js";
import { analyzeSway, pairCop } from "../../engine/sway.js";
import { mySummary, usualOf } from "./today.js";

export const EXERCISES = [
  { id: "weightShift", title: "Reach for the targets", icon: "target", minutes: 4, kind: "targets", blurb: "Lean to move the dot — side to side, forward and back",
    steps: ["Stand with feet hip-width apart, a counter in front of you.", "Lean your body — not your feet — to move the dot into each circle.", "Hold it there until it fills."] },
  { id: "steadyStance", title: "Steady stance", icon: "balance", minutes: 3, kind: "stance", blurb: "Three stances, 20 seconds each, with live sway",
    steps: ["Stand next to a counter you can hold if needed.", "Hold each stance as still as you can for 20 seconds.", "Watch the trail get smaller as you settle."] },
  { id: "heelRaise", title: "Heel raises", icon: "rise", minutes: 3, kind: "reps", detector: "toe", target: 10, blurb: "Rise onto your toes, then slowly down — 10 times",
    steps: ["Hold the back of a chair or the counter.", "Rise up onto your toes, then lower slowly.", "Steady counts each one."] },
  { id: "toeRaise", title: "Toe raises", icon: "foot", minutes: 2, kind: "reps", detector: "heel", target: 10, blurb: "Rock back onto your heels — 10 times",
    steps: ["Hold the back of a chair or the counter.", "Lift your toes, keeping your heels down.", "Lower and repeat."] },
  { id: "sitToStand", title: "Sit to stand", icon: "chair", minutes: 3, kind: "reps", detector: "rise", target: 10, blurb: "Stand up from a chair, arms crossed if you can — 10 times",
    steps: ["Sit near the front of a sturdy chair, feet flat.", "Stand up fully, then sit back down slowly.", "Use your hands if you need to — safety first."] },
  { id: "marching", title: "March in place", icon: "walk", minutes: 2, kind: "reps", detector: "step", target: 20, blurb: "Lift your knees — 20 steps, holding on if you like",
    steps: ["Stand at the counter.", "March on the spot, lifting each knee.", "Steady counts your steps."] },
  { id: "rhythmWalk", title: "Rhythm walk", icon: "activity", minutes: 5, kind: "rhythm", blurb: "Walk to a gentle beat you feel in your insoles",
    steps: ["Find a clear hallway or room.", "Your insoles tap left, right, left… step with the taps.", "Steady shows when you're in step."] },
  { id: "sensation", title: "Foot sensation check", icon: "vibrate", minutes: 3, kind: "sensation", blurb: "Can you feel the insoles buzz? 10 quick tries",
    steps: ["Sit down with your shoes and insoles on.", "Close your eyes if you like.", "Tap where you felt the buzz — or “I didn't feel anything”."] },
];

let X = null; // the running exercise
let timer = null, unsub = null, demoTimer = null;

function speak(t) {
  try { if ("speechSynthesis" in window && !X?.muted) { const u = new SpeechSynthesisUtterance(t); u.rate = 0.92; speechSynthesis.cancel(); speechSynthesis.speak(u); } } catch { /* no voice */ }
}

function stopAll() {
  clearInterval(timer); clearInterval(demoTimer); unsub?.();
  if (X?.beatTimer) clearTimeout(X.beatTimer);
  timer = demoTimer = unsub = null;
}

export function exerciseView(id) {
  const ex = EXERCISES.find((e) => e.id === id);
  if (!ex) { go("#/move"); return nothing; }
  if (!X || X.id !== id) { stopAll(); X = { id, ex, phase: "intro" }; }
  const body = X.phase === "intro" ? intro(ex) : X.phase === "done" ? done(ex) : running(ex);
  return html`<div class="shell" style="padding-bottom:40px">
    <header class="topbar">
      <button class="icon-btn" aria-label="Close" @click=${() => { stopAll(); X = null; go("#/move"); }}>${icon("close")}</button>
      <b class="grow">${ex.title}</b>
      <button class="icon-btn" aria-label=${X.muted ? "Turn voice on" : "Turn voice off"} @click=${() => { X.muted = !X.muted; update(); }}>${icon(X.muted ? "mute" : "volume")}</button>
    </header>
    <main class="stack" id="main">${body}</main>
  </div>`;
}

function intro(ex) {
  const connected = state.sense.status === "live" || senseService.demo;
  return html`
    <div class="center" style="padding:10px 0"><span class="avatar lg" style="width:96px;height:96px;margin:0 auto">${icon(ex.icon)}</span></div>
    <h1 class="center">${ex.title}</h1>
    <ol class="stack-sm" style="padding-left:1.2em;margin:0">${ex.steps.map((s) => html`<li>${s}</li>`)}</ol>
    ${!connected ? html`<div class="banner">${icon("bluetooth")}<span>Connect your insoles first — Steady needs them to coach you.</span></div>` : nothing}
    <button class="btn primary block" style="min-height:68px;font-size:1.15em" ?disabled=${!connected} @click=${() => start(ex)}>${icon("play")} Start</button>
    <p class="footnote">Stop if you feel dizzy, unsteady or unwell.</p>`;
}

// ---------- live signal ----------
function startSignal() {
  X.sig = { L: 0, R: 0, copL: null, copR: null, rL: null, rR: null, t: 0, trail: [] };
  if (senseService.demo) startDemoDriver();
  else unsub = senseService.onFrame((type, f) => { if (type === "pressure") feed(f.side, f.load, f.cop, f.regions, f.t); });
}

function feed(side, load, cop, regions, t) {
  if (!X?.sig) return;
  const s = X.sig;
  if (side === "left") { s.L = load; s.copL = cop; s.rL = regions; } else { s.R = load; s.copR = cop; s.rR = regions; }
  s.t = t;
  const W = senseService.monitor?.W ?? 1000;
  s.c = (s.L + s.R) / W;
  s.toe = toeShare(s);
  s.right = s.L + s.R > 0 ? s.R / (s.L + s.R) : 0.5;
  const p = pairCop(s.L, s.copL, s.R, s.copR);
  if (p) { s.trail.push({ t, x: p.x, y: p.y }); if (s.trail.length > 400) s.trail.shift(); }
  X.onSignal?.(s, t, W);
}
function toeShare(s) {
  const one = (r, cop) => (r ? (r.fore + r.toe) / Math.max(1e-9, r.heel + r.mid + r.fore + r.toe) : cop?.y ?? null);
  const a = one(s.rL, s.copL), b = one(s.rR, s.copR);
  return a != null && b != null ? (a + b) / 2 : a ?? b ?? 0.4;
}

// Demo: a simulated person who follows the exercise.
function startDemoDriver() {
  const W = 1000;
  let k = 0;
  demoTimer = setInterval(() => {
    if (!X) return;
    k++;
    const tsec = k / 25;
    let right = 0.5 + Math.sin(tsec * 1.3) * 0.02, toe = 0.42, c = 1, stepL = false, stepR = false;
    if (X.ex.kind === "targets" && X.target) {
      X.demoPos ??= { x: 0, y: 0 };
      X.demoPos.x += (X.target.x - X.demoPos.x) * 0.05 + (Math.random() - 0.5) * 0.03;
      X.demoPos.y += (X.target.y - X.demoPos.y) * 0.05 + (Math.random() - 0.5) * 0.03;
      right = 0.5 + X.demoPos.x * 0.32; toe = 0.42 + X.demoPos.y * 0.3;
    } else if (X.ex.kind === "stance") {
      const amp = [0.012, 0.022, 0.04][X.stage ?? 0] ?? 0.02;
      right = 0.5 + Math.sin(tsec * 2.1) * amp + (Math.random() - 0.5) * amp; toe = 0.42 + Math.cos(tsec * 1.7) * amp * 1.3;
    } else if (X.ex.detector === "toe") { toe = Math.sin(tsec * 2.2) > 0.2 ? 0.86 : 0.4; }
    else if (X.ex.detector === "heel") { toe = Math.sin(tsec * 2.2) > 0.2 ? 0.1 : 0.42; }
    else if (X.ex.detector === "rise") { c = Math.sin(tsec * 1.9) > 0 ? 1.05 : 0.22; }
    else if (X.ex.detector === "step" || X.ex.kind === "rhythm") {
      const per = X.ex.kind === "rhythm" ? 60 / ((X.bpm ?? 100) * 1.02) : 0.55;
      const phase = (tsec / per) % 2;
      stepL = phase > 0.25 && phase < 1; stepR = phase > 1.25;
      if (X.ex.kind === "rhythm" && senseService.monitor) {
        // let the live cadence readout follow the demo walker
        const sw = senseService.monitor._state;
        sw.recentSteps = Array.from({ length: 8 }, (_, i) => Date.now() - i * per * 1000).reverse();
        sw.live.cadence = Math.round(60 / per);
      }
    }
    const L = stepL ? 0.08 * W : stepR ? W * 0.92 : W * c * (1 - right);
    const R = stepR ? 0.08 * W : stepL ? W * 0.92 : W * c * right;
    const t = Date.now();
    const reg = (load) => ({ heel: load * (1 - toe), mid: 0, fore: load * toe * 0.7, toe: load * toe * 0.3 });
    feed("left", L, { x: 0.5, y: toe }, reg(L), t);
    feed("right", R, { x: 0.5, y: toe }, reg(R), t);
  }, 40);
}

// ---------- flows ----------
async function start(ex) {
  X.phase = "count"; X.count = 3; update();
  speak("Get ready.");
  for (let i = 3; i > 0; i--) { X.count = i; update(); await sleep(900); if (!X || X.ex !== ex) return; }
  X.phase = "run"; X.t0 = Date.now();
  startSignal();
  ({ targets: runTargets, stance: runStance, reps: runReps, rhythm: runRhythm, sensation: runSensation })[ex.kind](ex);
  timer = setInterval(update, 100);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function finish(result) {
  if (!X || X.phase === "done") return;
  X.result = result;
  X.phase = "done";
  speak("Well done.");
  senseService.vibrate("success");
  const ev = { kind: X.ex.kind === "sensation" ? "sensation" : "practice", at: new Date().toISOString(), detail: { exercise: X.ex.id, durationS: Math.round((Date.now() - X.t0) / 1000), ...result } };
  state.api.postEvent(ev).catch(() => {});
  invalidate("me:");
  stopAll();
  update();
}

const TARGETS = [{ x: -1, y: 0, label: "left" }, { x: 1, y: 0, label: "right" }, { x: 0, y: 1, label: "forward" }, { x: 0, y: -1, label: "back" }];
function runTargets() {
  const order = [...TARGETS, ...TARGETS].sort(() => Math.random() - 0.5);
  X.hits = 0; X.total = order.length; X.holdMs = 0;
  const next = () => { X.target = { ...order[X.hits], x: order[X.hits].x * 0.6, y: order[X.hits].y * 0.6 }; speak(`Lean ${X.target.label}.`); };
  next();
  let last = Date.now();
  X.onSignal = (s) => {
    const now = Date.now(); const dt = now - last; last = now;
    X.pos = { x: (s.right - 0.5) / 0.32, y: (s.toe - 0.42) / 0.3 };
    const d = Math.hypot(X.pos.x - X.target.x, X.pos.y - X.target.y);
    X.holdMs = d < 0.22 ? X.holdMs + dt : Math.max(0, X.holdMs - dt * 2);
    if (X.holdMs > 1500) {
      X.hits++; X.holdMs = 0;
      senseService.vibrate("success");
      if (X.hits >= X.total) finish({ reps: X.hits, score: Math.max(40, Math.round(100 - Math.max(0, (Date.now() - X.t0) / 1000 - 30))) });
      else next();
    }
  };
}

const STANCES = ["Feet together", "One foot half a step ahead", "Heel to toe"];
function runStance() {
  X.stage = 0; X.stageT0 = Date.now(); X.out = [];
  speak(STANCES[0]);
  X.onSignal = (s) => {
    if (Date.now() - X.stageT0 >= 20000) {
      const pts = s.trail.filter((p) => p.t >= X.stageT0 + 3000);
      X.out.push({ stance: STANCES[X.stage], swayRmsMm: analyzeSway(pts)?.rmsMm ?? null });
      X.stage++; s.trail = [];
      if (X.stage >= STANCES.length) return finish({ stances: X.out, score: null });
      X.stageT0 = Date.now(); speak(STANCES[X.stage]); senseService.vibrate("cue");
    }
  };
}

function runReps(ex) {
  X.reps = 0; X.armed = false;
  const loaded = { left: true, right: true };
  X.onSignal = (s, t, W) => {
    let rep = false;
    if (ex.detector === "toe") { if (!X.armed && s.toe > 0.75) X.armed = true; else if (X.armed && s.toe < 0.55) { X.armed = false; rep = true; } }
    if (ex.detector === "heel") { if (!X.armed && s.toe < 0.2) X.armed = true; else if (X.armed && s.toe > 0.35) { X.armed = false; rep = true; } }
    if (ex.detector === "rise") { if (!X.armed && s.c > 0.85) { X.armed = true; rep = true; } else if (X.armed && s.c < 0.45) X.armed = false; }
    if (ex.detector === "step") {
      for (const side of ["left", "right"]) {
        const v = side === "left" ? s.L : s.R;
        if (loaded[side] && v < 0.25 * W) loaded[side] = false;
        else if (!loaded[side] && v > 0.4 * W) { loaded[side] = true; rep = true; }
      }
    }
    if (rep) {
      X.reps++;
      senseService.vibrate("cue");
      if (X.reps === Math.floor(ex.target / 2)) speak("Halfway.");
      if (X.reps >= ex.target) finish({ reps: X.reps, score: null });
    }
  };
}

function runRhythm() {
  const s = mySummary();
  const usual = s.data ? usualOf(s.data.days, (d) => d.gait?.cadenceSpm) : null;
  X.bpm = X.bpm ?? Math.round((usual ?? 96) / 2) * 2;
  let side = "left";
  const tick = () => {
    if (!X || X.ex.kind !== "rhythm" || X.phase !== "run") return;
    senseService.vibrate(side);
    X.beatSide = side; side = side === "left" ? "right" : "left";
    X.beatTimer = setTimeout(tick, 60000 / X.bpm);
  };
  tick();
  X.onSignal = () => {
    if (Date.now() - X.t0 > 180000) finish({ bpm: X.bpm, cadence: senseService.monitor?.live()?.cadence ?? null, score: null });
  };
}

function runSensation() {
  X.trial = 0; X.trials = []; X.waiting = false;
  const plan = shuffle(["left", "right", "left", "right", "left", "right", "left", "right", "none", "none"]);
  const next = async () => {
    if (X.trial >= plan.length) {
      const hit = (s) => X.trials.filter((t) => t.truth === s && t.answer === s).length;
      const of = (s) => plan.filter((p) => p === s).length;
      return finish({ left: `${hit("left")}/${of("left")}`, right: `${hit("right")}/${of("right")}`, falseAlarms: X.trials.filter((t) => t.truth === "none" && t.answer !== "none").length, score: Math.round(((hit("left") + hit("right")) / (of("left") + of("right"))) * 100) });
    }
    X.waiting = false; update();
    await sleep(1500 + Math.random() * 2500);
    if (!X || X.ex.kind !== "sensation") return;
    const truth = plan[X.trial];
    if (truth !== "none") senseService.vibrate(truth);
    X.current = truth; X.waiting = true; update();
  };
  X.answer = (a) => { X.trials.push({ truth: X.current, answer: a }); X.trial++; next(); };
  X.onSignal = null;
  next();
}
function shuffle(a) { return a.map((v) => [Math.random(), v]).sort((p, q) => p[0] - q[0]).map((p) => p[1]); }

// ---------- running screens ----------
function running(ex) {
  if (X.phase === "count") return html`<div class="center" style="padding:60px 0"><div class="big-count">${X.count}</div><p class="ink-2">Get ready</p></div>`;
  const stop = html`<button class="btn block" @click=${() => finish({ stopped: true, reps: X.reps ?? X.hits ?? null })}>${icon("stop")} Finish</button>`;
  if (ex.kind === "targets") return html`${targetStage()}<p class="center ink-2" style="font-size:1.2em">Lean <b>${X.target?.label}</b> and hold · ${X.hits} of ${X.total}</p>${stop}`;
  if (ex.kind === "stance") {
    const left = Math.max(0, 20 - Math.floor((Date.now() - X.stageT0) / 1000));
    const recentPts = (X.sig?.trail ?? []).filter((p) => p.t > Date.now() - 3000);
    const sway = analyzeSway(recentPts)?.rmsMm;
    return html`<p class="center" style="font-size:1.3em"><b>${STANCES[X.stage]}</b></p>${swayStage()}
      <div class="row between"><span class="ink-2">${left} s left</span><span class="pill ${sway == null ? "" : sway < 6 ? "good" : sway < 10 ? "watch" : "review"}">${sway == null ? "Settling…" : sway < 6 ? "Very steady" : sway < 10 ? "Steady" : "Wobbly — hold on if you need"}</span></div>${stop}`;
  }
  if (ex.kind === "reps") return html`<div class="center" style="padding:30px 0"><div class="big-count" aria-live="polite">${X.reps}</div><p class="ink-2">of ${ex.target}</p></div>
    <div class="zbar" style="height:14px"><span class="fill better" style="left:0;width:${(X.reps / ex.target) * 100}%"></span></div>${stop}`;
  if (ex.kind === "rhythm") {
    const cad = senseService.monitor?.live()?.cadence;
    const inStep = cad != null && Math.abs(cad - X.bpm) <= 6;
    return html`<div class="center stack" style="padding:20px 0">
      <div class="row" style="justify-content:center;gap:40px">${["left", "right"].map((s) => html`<span class="avatar lg" style="${X.beatSide === s ? "background:var(--brand);color:var(--brand-ink);transform:scale(1.1)" : ""};transition:all .1s">${s === "left" ? "L" : "R"}</span>`)}</div>
      <div class="big-count" style="font-size:3.5em">${X.bpm}</div><p class="ink-2">steps per minute</p>
      <div class="row" style="justify-content:center"><button class="btn" @click=${() => { X.bpm -= 4; update(); }}>Slower</button><button class="btn" @click=${() => { X.bpm += 4; update(); }}>Faster</button></div>
      <span class="pill ${inStep ? "good" : ""}" style="justify-self:center">${cad == null ? "Start walking" : inStep ? "In step" : `You: ${cad} steps/min`}</span>
    </div>${stop}`;
  }
  if (ex.kind === "sensation") return html`<div class="center stack" style="padding:20px 0">
    <p class="muted">Try ${Math.min(X.trial + 1, 10)} of 10</p>
    <h2>${X.waiting ? "Did you feel a buzz?" : "Wait for it…"}</h2>
    ${senseService.demo ? html`<p class="small muted">Demo: no insoles, so answer as if you'd felt it.</p>` : nothing}
    <div class="grid-2" style="grid-template-columns:1fr 1fr">
      <button class="btn block" style="min-height:72px" ?disabled=${!X.waiting} @click=${() => X.answer("left")}>Left foot</button>
      <button class="btn block" style="min-height:72px" ?disabled=${!X.waiting} @click=${() => X.answer("right")}>Right foot</button>
    </div>
    <button class="btn block" ?disabled=${!X.waiting} @click=${() => X.answer("none")}>I didn't feel anything</button>
  </div>`;
  return nothing;
}

function targetStage() {
  const S = 300, c = S / 2, R = 120;
  const p = X.pos ?? { x: 0, y: 0 };
  const T = X.target ?? { x: 0, y: 0 };
  const fill = Math.min(1, (X.holdMs ?? 0) / 1500);
  return html`<div class="live-stage"><svg viewBox="0 0 ${S} ${S}" style="width:100%;max-width:420px;display:block;margin:0 auto" role="img" aria-label="Balance target">${svg`
    <circle cx=${c} cy=${c} r=${R} fill="var(--surface-2)" stroke="var(--line-strong)"></circle>
    <circle cx=${c} cy=${c} r=${R * 0.5} fill="none" stroke="var(--line)"></circle>
    <circle cx=${c + T.x * R} cy=${c - T.y * R} r="30" fill="var(--accent-soft)" stroke="var(--brand)" stroke-width="3"></circle>
    <circle cx=${c + T.x * R} cy=${c - T.y * R} r=${30 * fill} fill="var(--brand)" opacity="0.6"></circle>
    <circle cx=${c + Math.max(-1.1, Math.min(1.1, p.x)) * R} cy=${c - Math.max(-1.1, Math.min(1.1, p.y)) * R} r="14" fill="var(--ink)" stroke="var(--surface)" stroke-width="4"></circle>
    <text x=${c} y="16" text-anchor="middle" fill="var(--muted)" font-size="12">Forward</text>
  `}</svg></div>`;
}

function swayStage() {
  const S = 300, c = S / 2;
  const pts = (X.sig?.trail ?? []).slice(-150);
  if (pts.length < 2) return html`<div class="live-stage" style="height:300px"></div>`;
  const mx = pts.reduce((a, p) => a + p.x, 0) / pts.length, my = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  const k = 6;
  const d = pts.map((p, i) => `${i ? "L" : "M"}${(c + (p.x - mx) * k).toFixed(1)},${(c - (p.y - my) * k).toFixed(1)}`).join("");
  const last = pts[pts.length - 1];
  return html`<div class="live-stage"><svg viewBox="0 0 ${S} ${S}" style="width:100%;max-width:420px;display:block;margin:0 auto" role="img" aria-label="Your sway">${svg`
    ${[40, 80, 120].map((r) => svg`<circle cx=${c} cy=${c} r=${r} fill="none" stroke="var(--grid)"></circle>`)}
    <path d=${d} fill="none" stroke="var(--series-1)" stroke-width="2" stroke-linejoin="round" opacity="0.8"></path>
    <circle cx=${c + (last.x - mx) * k} cy=${c - (last.y - my) * k} r="9" fill="var(--brand)" stroke="var(--surface)" stroke-width="3"></circle>`}
  </svg></div>`;
}

function done(ex) {
  const r = X.result ?? {};
  const lines = [];
  if (r.reps != null) lines.push(`${r.reps} ${ex.kind === "targets" ? "targets reached" : "done"}`);
  if (r.stances) r.stances.forEach((s) => lines.push(`${s.stance}: sway ${s.swayRmsMm ?? "—"} mm`));
  if (r.bpm) lines.push(`Beat ${r.bpm} · your pace ${r.cadence ?? "—"} steps/min`);
  if (r.left) lines.push(`Felt left ${r.left} · right ${r.right}${r.falseAlarms ? ` · ${r.falseAlarms} buzz${r.falseAlarms > 1 ? "es" : ""} felt that weren't sent` : ""}`);
  return html`<div class="center stack" style="padding:20px 0">
    <span class="avatar lg" style="margin:0 auto;background:var(--good-soft);color:var(--good-ink)">${icon("check")}</span>
    <h1>Nice work</h1>
    ${lines.map((l) => html`<p class="ink-2">${l}</p>`)}
    ${ex.kind === "sensation" && r.score != null && r.score < 70 ? html`<div class="banner">${icon("info")}<span>Feeling in your feet helps balance. Your clinician will see this result.</span></div>` : nothing}
    <button class="btn primary block" @click=${() => { X = null; go("#/move"); }}>Back to Move</button>
    <button class="btn block" @click=${() => { X = { id: ex.id, ex, phase: "intro" }; update(); }}>Do it again</button>
  </div>`;
}
