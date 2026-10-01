// Safety moments: "Are you OK?" after a possible fall, and the dizziness log.
import { html, nothing } from "../../../vendor/lit.js";
import { state, set, update, invalidate, toast } from "../../app/state.js";
import { senseService } from "../../app/sense-service.js";
import { icon } from "../../ui/icons.js";

const WAIT_S = 60;
let tick = null;
let buzz = null;
let spoke = false;

function speak(text) {
  try {
    if (!("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.92;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch { /* no voice */ }
}

function stopTimers() { clearInterval(tick); clearInterval(buzz); tick = buzz = null; spoke = false; }

async function answer(outcome) {
  const o = state.overlay;
  stopTimers();
  set({ overlay: { ...o, answered: outcome } });
  const ev = {
    kind: "possibleFall", at: new Date(o.t ?? o.startedAt).toISOString(), outcome,
    detail: { impactG: o.impactG ?? null, confidence: o.confidence ?? null, answeredAfterS: Math.round((Date.now() - o.startedAt) / 1000), simulated: !!o.simulated },
  };
  try {
    if (o.eventId) await state.api.patchEvent(o.eventId, { outcome });
    else {
      const saved = await state.api.postEvent(ev);
      state.overlay = { ...state.overlay, eventId: saved?.id };
    }
  } catch { /* stays on device; synced later */ }
  invalidate("me:");
  if (outcome === "ok") { set({ overlay: null }); toast("Glad you're OK. Take a moment before you get up."); }
  else update();
}

export function fallOverlay() {
  const o = state.overlay;
  const left = Math.max(0, WAIT_S - Math.floor((Date.now() - o.startedAt) / 1000));
  if (!o.answered && !tick) {
    tick = setInterval(() => {
      if (state.overlay?.kind !== "fall") return stopTimers();
      if (Date.now() - state.overlay.startedAt >= WAIT_S * 1000 && !state.overlay.answered) answer("noResponse");
      update();
    }, 1000);
    buzz = setInterval(() => senseService.vibrate("alarm"), 5000);
    senseService.vibrate("alarm");
  }
  if (!spoke && !o.answered) { spoke = true; speak("Are you OK? Tap I'm OK, or I need help."); }
  if (o.answered && o.answered !== "ok") {
    return html`<div class="fullscreen" role="alertdialog" aria-labelledby="fall-h">
      <div class="stack center" style="max-width:460px">
        <div class="avatar lg" style="margin:0 auto;background:var(--urgent-soft);color:var(--urgent-ink)">${icon("bell")}</div>
        <h1 id="fall-h">${o.answered === "needHelp" ? "Help is on the way" : "We've let your circle know"}</h1>
        <p class="ink-2">${o.answered === "needHelp" ? "Your care circle has been alerted." : "You didn't answer, so Steady alerted your care circle."} If you're hurt, call 911.</p>
        <a class="btn danger block" href="tel:911">${icon("phone")} Call 911</a>
        <button class="btn good block" @click=${() => answer("ok")}>${icon("check")} I'm OK now</button>
      </div></div>`;
  }
  const r = 54, c = 2 * Math.PI * r;
  return html`<div class="fullscreen" role="alertdialog" aria-labelledby="fall-h" aria-describedby="fall-d">
    <div class="stack center" style="max-width:460px;width:100%">
      <div class="timer-ring alarm" style="width:150px;height:150px">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle cx="60" cy="60" r=${r} fill="none" stroke="var(--surface-3)" stroke-width="8"></circle>
          <circle cx="60" cy="60" r=${r} fill="none" stroke="var(--urgent)" stroke-width="8" stroke-linecap="round" stroke-dasharray=${c} stroke-dashoffset=${c * (1 - left / WAIT_S)}></circle>
        </svg>
        <div class="center"><div><b style="font-size:2em">${left}</b><div class="small muted">seconds</div></div></div>
      </div>
      <h1 id="fall-h" style="font-size:2.2em">Are you OK?</h1>
      <p id="fall-d" class="ink-2">It looks like you may have fallen. If you don't answer, Steady will alert your care circle in ${left} seconds.</p>
      <button class="btn good block" style="min-height:76px;font-size:1.3em" @click=${() => answer("ok")}>${icon("check")} I'm OK</button>
      <button class="btn danger block" style="min-height:76px;font-size:1.3em" @click=${() => answer("needHelp")}>${icon("bell")} I need help</button>
      ${o.simulated ? html`<p class="footnote">Practice run — this was a simulated fall.</p>` : nothing}
    </div></div>`;
}

const CONTEXTS = [
  ["standingUp", "Just after standing up"],
  ["turning", "When I turned my head or rolled over"],
  ["walking", "While walking"],
  ["still", "Sitting or lying still"],
  ["unsure", "Not sure"],
];
const STRENGTH = [["mild", "Mild"], ["moderate", "Moderate"], ["strong", "Strong"]];

export function dizzySheet() {
  const o = state.overlay;
  o.auto ??= senseService.dizzyContext();
  o.context ??= o.auto.context ?? null;
  const pick = (k, v) => { state.overlay = { ...state.overlay, [k]: v }; update(); };
  const save = async () => {
    const detail = { context: o.context ?? "unsure", autoContext: o.auto.autoContext ?? null, strength: o.strength ?? null };
    set({ overlay: null });
    await state.api.postEvent({ kind: "dizzy", at: new Date().toISOString(), detail }).catch(() => {});
    invalidate("me:");
    toast("Logged. Sit down until it passes.");
  };
  return html`<div class="sheet-backdrop" @click=${(e) => e.target === e.currentTarget && set({ overlay: null })}>
    <div class="sheet stack" role="dialog" aria-modal="true" aria-labelledby="dz-h">
      <div class="grab"></div>
      <h2 id="dz-h">Feeling dizzy</h2>
      <p class="ink-2">Sit down if you can. Logging when it happens helps your clinician find the cause.</p>
      ${o.auto.autoContext ? html`<div class="banner">${icon("sparkles")}<span>Steady noticed: <b>${o.auto.autoContext.toLowerCase()}</b></span></div>` : nothing}
      <fieldset class="stack-sm" style="border:0;padding:0;margin:0">
        <legend class="small" style="font-weight:700;margin-bottom:6px">When did it start?</legend>
        ${CONTEXTS.map(([k, label]) => html`<button class="btn block" style="justify-content:flex-start;text-align:left" aria-pressed=${o.context === k ? "true" : "false"}
          @click=${() => pick("context", k)}>${o.context === k ? icon("checkCircle") : icon("chevronRight")} ${label}</button>`)}
      </fieldset>
      <div class="row wrap" role="group" aria-label="How strong">
        ${STRENGTH.map(([k, label]) => html`<button class="chip" aria-pressed=${o.strength === k ? "true" : "false"} @click=${() => pick("strength", k)}>${label}</button>`)}
      </div>
      <button class="btn primary block" @click=${save}>Save</button>
      <p class="footnote">If dizziness comes with chest pain, trouble speaking, weakness or a bad headache, call 911.</p>
    </div></div>`;
}
