// Steady Check: guided at-home tests measured by the insoles.
import { html, svg, nothing } from "../../../vendor/lit.js";
import { state, update, invalidate, go, toast } from "../../app/state.js";
import { senseService } from "../../app/sense-service.js";
import { icon } from "../../ui/icons.js";
import { ring, fmtDate } from "../../ui/components.js";
import { walkTest, balanceTest, chairStandTest, tugTest, summarizeCheck, STAGES, CHECK } from "../../engine/checks.js";
import { mySummary } from "./today.js";

const TESTS = [
  { key: "walk", title: "Walk", icon: "walk", say: "Walk at your usual pace to the end of the path, then stop and stand still.",
    steps: ["Stand at the start of a clear 4-metre (13-foot) path.", "After the beep, walk at your usual pace past the end mark.", "Stop and stand still — Steady finishes on its own."],
    make: (W) => walkTest({ W, courseM: 4 }), demo: [{ kind: "stand", s: 1 }, { kind: "walk", s: 4.4, cadence: 98, strideCv: 3 }, { kind: "stand", s: 3 }] },
  { key: "balance", title: "Balance", icon: "balance", say: "Feet side by side. Hold still.",
    steps: ["Stand next to a counter you can grab.", "Hold four stances for 10 seconds each — each a bit harder.", "If you need to step or grab, that's fine: Steady stops there."],
    make: (W, on) => balanceTest({ W, onUpdate: on }), demo: [{ kind: "stand", s: 10.4, swayMm: 3 }, { kind: "stand", s: 10.4, swayMm: 5 }, { kind: "stand", s: 10.4, swayMm: 9 }, { kind: "stand", s: 0.6 }, { kind: "oneLeg", s: 4.2, side: "left" }, { kind: "stand", s: 3 }] },
  { key: "chair", title: "Chair stands", icon: "chair", say: "Arms crossed. Stand up fully and sit down, as many times as you can in thirty seconds.",
    steps: ["Sit in the middle of a sturdy chair, feet flat, arms crossed.", "After the beep, stand up fully and sit back down — as many times as you can in 30 seconds.", "Use your hands if you must; safety first."],
    make: (W, on) => chairStandTest({ W, onUpdate: on }), demo: [{ kind: "sit", s: 0.6 }, ...Array.from({ length: 11 }, () => [{ kind: "rise", s: 1.45, riseS: 0.95 }, { kind: "sitDown", s: 1.2 }]).flat(), { kind: "sit", s: 4 }] },
  { key: "tug", title: "Up & go", icon: "timer", say: "Stand up, walk to the mark, turn around, walk back and sit down.",
    steps: ["Sit in a chair with a mark 3 metres (10 feet) away.", "After the beep, stand, walk to the mark at your usual pace, turn, walk back and sit.", "Steady times it from your insoles."],
    make: (W, on) => tugTest({ W, onUpdate: on }), demo: [{ kind: "sit", s: 0.8 }, { kind: "rise", s: 1.6, riseS: 1.3 }, { kind: "walk", s: 7.6, cadence: 96 }, { kind: "sitDown", s: 1.2 }, { kind: "sit", s: 3 }] },
  { key: "talkWalk", title: "Talk & walk", icon: "message", optional: true, say: "Walk the path again, counting backwards from one hundred by threes, out loud.",
    steps: ["Back to the start of the path.", "Walk it again while counting backwards from 100 by threes, out loud.", "This shows how much a busy mind changes your walk."],
    make: (W) => walkTest({ W, courseM: 4, variant: "dual" }), demo: [{ kind: "stand", s: 1 }, { kind: "walk", s: 5.2, cadence: 88, strideCv: 5 }, { kind: "stand", s: 3 }] },
];

let C = null; // check session
let tick = null, unsub = null, stopDemo = null;

function speak(t) {
  try { if ("speechSynthesis" in window && !C?.muted) { const u = new SpeechSynthesisUtterance(t); u.rate = 0.92; speechSynthesis.cancel(); speechSynthesis.speak(u); } } catch { /* no voice */ }
}
function beep() {
  try {
    C.audio ??= new (window.AudioContext || window.webkitAudioContext)();
    const o = C.audio.createOscillator(), g = C.audio.createGain();
    o.frequency.value = 880; o.connect(g); g.connect(C.audio.destination); g.gain.value = 0.2;
    o.start(); o.stop(C.audio.currentTime + 0.18);
  } catch { /* no audio */ }
  senseService.vibrate("cue");
}
function stopRun() { clearInterval(tick); unsub?.(); stopDemo?.(); tick = unsub = stopDemo = null; }

export function checkView(sub) {
  if (!sub) { stopRun(); C = null; return overview(); }
  if (!C) C = { step: -1, results: {}, phase: "intro" };
  return html`<div class="shell" style="padding-bottom:40px">
    <header class="topbar">
      <button class="icon-btn" aria-label="Close" @click=${() => { stopRun(); C = null; go("#/check"); }}>${icon("close")}</button>
      <div class="grow center">${C.step >= 0 && C.step < TESTS.length ? html`<div class="step-dots">${TESTS.map((_, i) => html`<i class=${i === C.step ? "on" : ""}></i>`)}</div>` : html`<b>Steady Check</b>`}</div>
      <button class="icon-btn" aria-label=${C.muted ? "Turn voice on" : "Turn voice off"} @click=${() => { C.muted = !C.muted; update(); }}>${icon(C.muted ? "mute" : "volume")}</button>
    </header>
    <main class="stack" id="main">${body()}</main>
  </div>`;
}

function overview() {
  const s = mySummary();
  const checks = s.data?.checks ?? [];
  return html`
    <h1>Steady Check</h1>
    <p class="ink-2">Five short tests that balance specialists use, measured by your insoles. About 6 minutes. Doing it every week shows how things are trending.</p>
    <section class="card stack-sm">
      <h3>You'll need</h3>
      <ul class="note-list">
        <li>${icon("chair")}<span>A sturdy chair without wheels</span></li>
        <li>${icon("walk")}<span>A clear path about 4 metres (13 feet) long — mark the end</span></li>
        <li>${icon("balance")}<span>A counter or wall within reach</span></li>
        <li>${icon("people")}<span>Ideally, someone nearby</span></li>
      </ul>
    </section>
    <a class="btn primary block" style="min-height:68px;font-size:1.15em" href="#/check/run">${icon("play")} Start the check</a>
    ${checks.length ? html`<h2 class="section-title">Past checks</h2>
      <div class="list">${checks.slice(0, 6).map((c) => html`<div class="row"><span class="grow">${fmtDate(c.takenAt.slice(0, 10), { weekday: "short", month: "short", day: "numeric" })}</span><b>${c.score}</b><span class="small muted">of 100</span></div>`)}</div>` : nothing}
    <p class="footnote">Stop at any time if you feel unsteady. These tests track change over time; they are not a medical assessment.</p>`;
}

function body() {
  if (C.phase === "intro") return html`
    <h1>Before you start</h1>
    <ul class="note-list">
      <li>${icon("shield")}<span>Stay near something sturdy. Skip any test you don't feel safe doing.</span></li>
      <li>${icon("volume")}<span>Steady will talk you through each step and beep to start.</span></li>
      <li>${icon("foot")}<span>First, stand still for 3 seconds so Steady can weigh in.</span></li>
    </ul>
    ${state.sense.status !== "live" && !senseService.demo ? html`<div class="banner">${icon("bluetooth")}<span>Connect your insoles to run the check.</span></div>` : nothing}
    <button class="btn primary block" style="min-height:68px" ?disabled=${state.sense.status !== "live" && !senseService.demo} @click=${weighIn}>${icon("foot")} Stand still and weigh in</button>`;
  if (C.phase === "weighing") return html`<div class="center stack" style="padding:40px 0"><div class="big-count" style="font-size:3em">${icon("foot")}</div><h2>Stand still…</h2><p class="ink-2">Weight on both feet, looking ahead.</p></div>`;
  if (C.phase === "results") return results();
  const t = TESTS[C.step];
  if (C.phase === "ready") return html`
    <div class="center"><span class="avatar lg" style="width:88px;height:88px;margin:0 auto">${icon(t.icon)}</span></div>
    <h1 class="center">${t.title}</h1>
    <ol class="stack-sm" style="padding-left:1.2em;margin:0">${t.steps.map((s) => html`<li>${s}</li>`)}</ol>
    <button class="btn primary block" style="min-height:68px;font-size:1.15em" @click=${() => run(t)}>${icon("play")} Start</button>
    <button class="btn ghost block" @click=${() => advance(null)}>Skip this one</button>`;
  if (C.phase === "count") return html`<div class="center" style="padding:60px 0"><div class="big-count">${C.count}</div><p class="ink-2">${t.title}</p></div>`;
  if (C.phase === "run") return runningView(t);
  if (C.phase === "result") return resultView(t);
  return nothing;
}

async function weighIn() {
  C.phase = "weighing"; update();
  speak("Stand still, with your weight on both feet.");
  const r = await senseService.weighIn();
  if (!r.ok) { toast("Steady couldn't get a steady reading. Stand still and try again."); C.phase = "intro"; update(); return; }
  C.W = r.W;
  C.step = 0; C.phase = "ready"; update();
  speak(TESTS[0].title);
}

async function run(t) {
  C.phase = "count";
  for (let i = 3; i > 0; i--) { C.count = i; update(); await new Promise((r) => setTimeout(r, 850)); if (!C) return; }
  const W = C.W ?? senseService.monitor?.W ?? 1000;
  C.progress = {};
  C.runner = t.make(W, (p) => { C.progress = { ...C.progress, ...p }; if (p.phase === "stage") speak(p.label); if (p.phase === "count") senseService.vibrate("cue"); });
  C.phase = "run"; C.t0 = Date.now();
  beep(); speak(t.say);
  C.runner.start(Date.now());
  unsub = senseService.onFrame((type, f) => { if (type === "pressure") C?.runner?.pressure(f); });
  if (senseService.demo) stopDemo = senseService.play(t.demo, { seed: 4 + C.step });
  tick = setInterval(() => {
    const res = C?.runner?.tick(Date.now());
    if (res) { stopRun(); C.last = res; C.phase = "result"; beep(); speak(res.ok ? "Done." : "That one didn't record. You can try again or skip."); }
    update();
  }, 100);
}

function runningView(t) {
  const el = (Date.now() - C.t0) / 1000;
  if (t.key === "chair") {
    const left = Math.max(0, Math.ceil((C.progress.leftMs ?? CHECK.chairMs) / 1000));
    return html`<div class="center stack" style="padding:20px 0">${timerRing(left, 30)}<div class="big-count" style="font-size:3em">${C.progress.count ?? 0}</div><p class="ink-2">stands</p></div>`;
  }
  if (t.key === "balance") {
    const st = C.progress.stage ?? 0;
    const elS = (C.progress.elapsedMs ?? 0) / 1000;
    return html`<div class="center stack" style="padding:10px 0">
      <p class="muted">Stance ${st + 1} of 4</p><h2>${STAGES[st]?.label}</h2>
      ${timerRing(Math.max(0, Math.ceil(10 - elS)), 10)}
      ${st === 3 ? html`<p class="ink-2">Lift one foot — the timer starts when it leaves the floor.</p>` : nothing}</div>`;
  }
  return html`<div class="center stack" style="padding:40px 0"><div class="big-count" style="font-size:3.4em">${el.toFixed(1)}</div><p class="ink-2">seconds</p>
    <p class="ink-2">${t.key === "tug" ? (C.progress.phase === "up" ? "Walk to the mark, turn, come back and sit." : "Stand up when ready.") : "Walk at your usual pace, then stop."}</p></div>`;
}

function timerRing(left, total) {
  const r = 54, c = 2 * Math.PI * r;
  return html`<div class="timer-ring" style="width:180px;height:180px"><svg viewBox="0 0 120 120" aria-hidden="true">${svg`
    <circle cx="60" cy="60" r=${r} fill="none" stroke="var(--surface-3)" stroke-width="8"></circle>
    <circle cx="60" cy="60" r=${r} fill="none" stroke="var(--brand)" stroke-width="8" stroke-linecap="round" stroke-dasharray=${c} stroke-dashoffset=${c * (1 - left / total)}></circle>`}</svg>
    <div class="center"><div><b style="font-size:2.2em">${left}</b><div class="small muted">seconds</div></div></div></div>`;
}

function resultView(t) {
  const r = C.last;
  const line = !r.ok ? "Didn't record" : {
    walk: `${r.durationS} s · ${r.speedMps} m/s · ${r.steps} steps`,
    talkWalk: `${r.durationS} s · ${r.speedMps} m/s while counting`,
    balance: `${r.completed} of 4 stances held${r.stoppedAt ? ` · stopped at ${STAGES.find((s) => s.key === r.stoppedAt)?.label.toLowerCase()}` : ""}`,
    chair: `${r.count} stands in 30 seconds`,
    tug: `${r.totalS} seconds`,
  }[t.key];
  return html`<div class="center stack" style="padding:20px 0">
    <span class="avatar lg" style="margin:0 auto;${r.ok ? "background:var(--good-soft);color:var(--good-ink)" : ""}">${icon(r.ok ? "check" : "info")}</span>
    <h1>${t.title}</h1><p class="ink-2" style="font-size:1.2em">${line}</p>
    <button class="btn primary block" @click=${() => advance(r.ok ? r : null)}>${C.step >= TESTS.length - 1 ? "See results" : "Next"} ${icon("chevronRight")}</button>
    <button class="btn block" @click=${() => { C.phase = "ready"; update(); }}>${icon("refresh")} Try again</button>
  </div>`;
}

function advance(result) {
  const t = TESTS[C.step];
  if (result) C.results[t.key] = result;
  C.step++;
  if (C.step >= TESTS.length) { finishCheck(); return; }
  C.phase = "ready"; update();
  speak(TESTS[C.step].title);
}

async function finishCheck() {
  const s = mySummary();
  const profile = s.data?.profile ?? {};
  const age = profile.birthYear ? new Date().getFullYear() - profile.birthYear : null;
  C.summary = summarizeCheck(C.results, { age, sex: profile.sex });
  C.phase = "results"; update();
  speak(C.summary.score != null ? `All done. Your score is ${C.summary.score}.` : "All done.");
  try {
    await state.api.postCheck({ takenAt: new Date().toISOString(), score: C.summary.score, results: C.results, summary: C.summary });
    invalidate("me:");
  } catch { toast("Saved on this device. It will sync later."); }
}

function results() {
  const sm = C.summary;
  const prev = mySummary().data?.checks?.find((c) => Date.now() - new Date(c.takenAt).getTime() > 60000);
  const delta = prev && sm.score != null ? sm.score - prev.score : null;
  return html`<div class="center stack">
    <h1>All done</h1>
    ${sm.score != null ? html`<div style="margin:0 auto">${ring({ value: sm.score, max: 100, label: String(sm.score), sub: "of 100", size: 150 })}</div>` : nothing}
    ${delta != null ? html`<p class="ink-2">${delta >= 0 ? `Up ${delta}` : `Down ${-delta}`} from your last check (${prev.score}).</p>` : nothing}
  </div>
  <div class="list">${sm.components.map((c) => html`<div class="row"><span class="grow">${c.label}</span><b>${c.value} <span class="small muted">${c.unit}</span></b></div>`)}
    ${sm.dualTaskCostPct != null ? html`<div class="row"><span class="grow">Walking while counting</span><b>${sm.dualTaskCostPct}% slower</b></div>` : nothing}</div>
  <p class="footnote">Your score tracks your own change from week to week. It isn't a medical test. ${prev ? "" : "Your next check will show how things are trending."}</p>
  <button class="btn primary block" @click=${() => { C = null; go("#/today"); }}>Done</button>`;
}
