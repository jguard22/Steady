import { html, nothing } from "../../vendor/lit.js";
import { state, update, toast, invalidate, load } from "../app/state.js";
import { endSession, signOut } from "../app/session.js";
import { senseService } from "../app/sense-service.js";
import { prefs } from "../store/kv.js";
import { icon } from "../ui/icons.js";
import { apiBase, setApiBase } from "../cloud/auth.js";
import { signIn } from "./welcome.js";
import { DEMO_IDENTITIES } from "../cloud/demo-api.js";

function setTheme(t) {
  if (t === "auto") { delete document.documentElement.dataset.theme; prefs.del("theme"); }
  else { document.documentElement.dataset.theme = t; prefs.set("theme", t); }
  update();
}

export function settingsView() {
  const theme = prefs.get("theme", "auto");
  const text = prefs.get("textSize", "normal");
  const me = state.role === "wearer" ? load("me", () => state.api.me(), { ttl: 60000 }) : null;
  const profile = me?.data?.profile;
  const who = state.mode === "demo"
    ? { wearer: "Margaret Ellis (demo)", family: `${DEMO_IDENTITIES.FAMILY.displayName} (demo)`, clinician: `${DEMO_IDENTITIES.CLINICIAN.displayName} (demo)` }[state.role]
    : state.user?.name ?? state.user?.email ?? (state.mode === "local" ? "On this device only" : "Signed in");
  return html`
    <h1>Settings</h1>
    <section class="card stack-sm">
      <div class="row"><span class="avatar">${icon("user")}</span><div class="grow"><b>${who}</b>
        <div class="small muted">${{ wearer: "Wearing the insoles", family: "Family & caregivers", clinician: "Clinician" }[state.role]}${state.mode === "local" ? " · data stays on this device" : ""}</div></div></div>
      ${state.mode === "local" ? html`<button class="btn primary" @click=${() => signIn(state.role)}>${icon("lock")} Sign in to share with family or a clinician</button>` : nothing}
    </section>

    ${state.role === "wearer" && profile ? html`<section class="card stack">
      <h3>About you</h3>
      <div class="field"><label for="nm">Your first name</label><input id="nm" class="input" .value=${profile.displayName ?? ""} @change=${(e) => saveProfile({ displayName: e.target.value })} /></div>
      <div class="grid-2">
        <div class="field"><label for="by">Year of birth</label><input id="by" class="input" inputmode="numeric" .value=${profile.birthYear ?? ""} @change=${(e) => saveProfile({ birthYear: Number(e.target.value) || null })} /></div>
        <div class="field"><label for="sx">Sex <span class="muted">(for check references)</span></label>
          <select id="sx" class="input" @change=${(e) => saveProfile({ sex: e.target.value || null })}>
            ${[["", "Prefer not to say"], ["female", "Female"], ["male", "Male"]].map(([v, l]) => html`<option value=${v} ?selected=${(profile.sex ?? "") === v}>${l}</option>`)}
          </select></div>
      </div>
      <label class="row between"><span><b>Rise & pause reminder</b><div class="small muted">A gentle buzz in your insoles after you stand up, to pause before walking.</div></span>
        <span class="switch"><input type="checkbox" .checked=${profile.settings?.riseAndPauseAlways ?? false} @change=${(e) => saveProfile({ settings: { ...profile.settings, riseAndPauseAlways: e.target.checked } })} /><span></span></span></label>
    </section>` : nothing}

    <section class="card stack">
      <h3>Display</h3>
      <div class="row between wrap"><span>Text size</span>
        <div class="segmented" role="group" aria-label="Text size">
          ${[["normal", "A"], ["large", "A+"], ["larger", "A++"]].map(([v, l]) => html`<button aria-pressed=${text === v ? "true" : "false"} @click=${() => { prefs.set("textSize", v); update(); }}>${l}</button>`)}
        </div></div>
      <div class="row between wrap"><span>Appearance</span>
        <div class="segmented" role="group" aria-label="Appearance">
          ${[["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]].map(([v, l]) => html`<button aria-pressed=${theme === v ? "true" : "false"} @click=${() => setTheme(v)}>${l}</button>`)}
        </div></div>
    </section>

    ${state.role === "wearer" ? html`<section class="stack-sm">
      <a class="action" href="#/station"><span class="badge-icon">${icon("station")}</span><span class="grow"><b>Home Station</b><span class="sub">Turn a spare phone or tablet into an always-on Steady screen</span></span>${icon("chevronRight")}</a>
      ${state.mode === "demo" ? html`<button class="action" @click=${() => senseService.simulateFall()}><span class="badge-icon" style="background:var(--urgent-soft);color:var(--urgent-ink)">${icon("alert")}</span><span class="grow"><b>Practice the “Are you OK?” screen</b><span class="sub">See what happens after a possible fall</span></span>${icon("chevronRight")}</button>` : nothing}
    </section>` : nothing}

    <section class="card stack-sm">
      <h3>Privacy</h3>
      <p class="small ink-2">Steady turns insole readings into daily summaries on your device. Raw readings aren't uploaded. ${state.role === "wearer" ? "You choose who sees what on the Circle screen, and you can remove anyone at any time." : "You see only what the person chose to share with you."}</p>
      <p class="footnote">${state.api?.nonClinical}</p>
    </section>

    <details class="card">
      <summary class="small muted">Advanced</summary>
      <div class="field" style="margin-top:10px"><label for="api">Cloud address</label>
        <input id="api" class="input" .value=${apiBase()} @change=${(e) => { setApiBase(e.target.value.trim()); toast("Saved. Sign in again to use it."); }} /></div>
    </details>

    ${state.mode === "cloud" ? html`<button class="btn block" @click=${signOut}>${icon("logout")} Sign out</button>` : html`<button class="btn block" @click=${endSession}>${icon("logout")} ${state.mode === "demo" ? "Leave the demo" : "Switch perspective"}</button>`}
    <p class="footnote center">Steady by BrilliantWear · v0.1</p>
  `;
}

async function saveProfile(patch) {
  await state.api.updateProfile(patch).catch(() => {});
  invalidate("me");
  toast("Saved.");
}
