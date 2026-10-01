// Home Station: a spare phone or tablet, plugged in at home, that keeps
// Steady listening all day and doubles as a calm, glanceable display.
import { html, nothing } from "../../../vendor/lit.js";
import { state, set, openSheet, update } from "../../app/state.js";
import { senseService } from "../../app/sense-service.js";
import { icon, mark } from "../../ui/icons.js";
import { minutesText, fmtNum } from "../../ui/components.js";
import { STATUS_TEXT } from "../../engine/baseline.js";
import { mySummary } from "./today.js";

let clock = null;

export function stationView() {
  clearInterval(clock);
  clock = setInterval(() => { if (state.route.parts[0] === "station") update(); else clearInterval(clock); }, 15000);
  const s = mySummary();
  const now = new Date();
  const night = now.getHours() >= 21 || now.getHours() < 6;
  const today = (state.mode !== "demo" && senseService.monitor?.today()) || s.data?.days?.find((d) => d.date === state.api.today());
  const st = s.data?.evaluation?.status ?? "learning";
  const connected = state.sense.status === "live";
  return html`<div class="fullscreen" style="align-content:stretch;${night ? "filter:brightness(.55)" : ""}">
    <div class="stack" style="width:min(720px,100%);align-content:space-between;height:100%;padding:12px 0">
      <div class="row between">
        <span class="row">${mark()}<b>Steady</b></span>
        <span class="pill ${connected ? "good" : "info"}">${icon("foot")} ${connected ? "Listening" : "Insoles not connected"}</span>
        <a class="btn small ghost" href="#/today" aria-label="Exit Home Station">${icon("close")}</a>
      </div>
      <div class="center stack-sm">
        <div style="font-size:clamp(64px,16vw,140px);font-weight:750;letter-spacing:-0.04em;line-height:1">${now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</div>
        <div class="ink-2" style="font-size:1.4em">${now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</div>
      </div>
      <div class="grid-3">
        <div class="tile"><div class="label">This week</div><div class="value" style="font-size:1.2em">${STATUS_TEXT[st].title}</div></div>
        <div class="tile"><div class="label">Walking today</div><div class="value">${minutesText(today?.minutes?.walk ?? 0)}</div></div>
        <div class="tile"><div class="label">Steps</div><div class="value">${fmtNum(today?.steps ?? 0)}</div></div>
      </div>
      <div class="grid-2" style="grid-template-columns:1fr 1fr">
        <button class="btn block" style="min-height:80px;font-size:1.2em" @click=${() => set({ overlay: { kind: "dizzy" } })}>${icon("dizzy")} I feel dizzy</button>
        <button class="btn danger block" style="min-height:80px;font-size:1.2em" @click=${helpNow}>${icon("bell")} I need help</button>
      </div>
      <button class="btn ghost small" style="justify-self:center" @click=${() => openSheet(setupSheet)}>${icon("info")} Setting up a Home Station</button>
    </div>
  </div>`;
}

async function helpNow() {
  await state.api.postEvent({ kind: "help", at: new Date().toISOString(), detail: { from: "station" } }).catch(() => {});
  senseService.vibrate("success");
  state.toast = "Your circle has been alerted.";
  update();
  setTimeout(() => { state.toast = null; update(); }, 3000);
}

function setupSheet() {
  return html`<div class="stack">
    <h2>Home Station</h2>
    <p class="ink-2">Phones put apps to sleep when the screen is off. A spare phone or tablet that stays on at home lets Steady listen to your insoles all day.</p>
    <ol class="stack-sm" style="padding-left:1.2em;margin:0">
      <li>Plug it in where you spend most of your day.</li>
      <li>In its Settings, set <b>Display → Auto-Lock</b> to <b>Never</b>.</li>
      <li>Open Steady in the BrilliantWear app and choose Home Station.</li>
      <li>Keep your insoles within about 10 metres (30 feet).</li>
    </ol>
    <p class="footnote">The screen dims at night. Your other BrilliantWear apps keep working alongside Steady.</p>
  </div>`;
}
