import { html, nothing } from "../../vendor/lit.js";
import { state, update, toast, invalidate, load } from "../app/state.js";
import { endSession, signOut } from "../app/session.js";
import { senseService } from "../app/sense-service.js";
import { prefs } from "../store/kv.js";
import { icon } from "../ui/icons.js";
import { apiBase, setApiBase, formatPhone, looksLikePhone, authOptions } from "../cloud/auth.js";
import { openSheet, closeSheet } from "../app/state.js";
import { DEMO_IDENTITIES } from "../cloud/demo-api.js";

export const MARKETING_CONSENT =
  "Yes, text me occasional news and offers from BrilliantWear (up to 4 a month). Msg & data rates may apply. Reply STOP to unsubscribe. Not required to use Steady.";

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
      ${state.mode === "local" ? html`<a class="btn primary" href=${`#/start/${state.role}`}>${icon("message")} Sign in with my email to share with family or a clinician</a>` : nothing}
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

    ${state.mode === "cloud" ? phoneCard() : nothing}

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

// ---------- mobile number ----------
function phoneCard() {
  const r = load("me:phone", () => Promise.all([state.api.phone(), authOptions()]).then(([p, o]) => ({ ...p, codes: o.sms })), { ttl: 60000 });
  const d = r.data;
  if (!d || d.unavailable) return nothing;
  if (!d.phone) {
    if (!d.codes) return nothing; // texting isn't switched on yet
    return html`<section class="card stack-sm">
      <h3>Mobile number</h3>
      <p class="small ink-2">${state.role === "wearer" ? "Sign in with a text instead of email, and keep your account safe." : "Get a text right away if someone you look out for may need you."}</p>
      <button class="btn primary" @click=${addPhoneSheet}>${icon("phone")} Add my mobile number</button>
    </section>`;
  }
  const save = async (patch) => {
    try { await state.api.setPhone(patch); invalidate("me:phone"); toast("Saved."); } catch (e) { toast(e.message); }
  };
  return html`<section class="card stack">
    <div class="row"><h3 class="grow">Mobile number</h3><b>${formatPhone(d.phone)}</b></div>
    ${state.role !== "wearer" ? html`<label class="row between"><span><b>Text me urgent alerts</b>
        <div class="small muted">A possible fall with no answer, or a request for help. No health details in the text.${d.textsAvailable ? "" : " Texts start as soon as BrilliantWear's number is approved; until then alerts come by email."}</div></span>
      <span class="switch"><input type="checkbox" .checked=${d.smsAlerts !== false} @change=${(e) => save({ smsAlerts: e.target.checked })} /><span></span></span></label>` : nothing}
    <label class="row" style="align-items:flex-start;gap:12px">
      <input type="checkbox" style="width:24px;height:24px;margin-top:2px;flex:none" .checked=${!!d.marketingOptIn}
        @change=${(e) => save(e.target.checked ? { marketingOptIn: true, consentText: MARKETING_CONSENT } : { marketingOptIn: false })} />
      <span class="small ink-2">${MARKETING_CONSENT}</span>
    </label>
    <button class="btn ghost small" style="justify-self:start" @click=${async () => {
      try { await state.api.removePhone(); invalidate("me:phone"); toast("Number removed."); }
      catch (e) { toast(e.code === "only_sign_in" || /only/.test(e.message) ? "This number is how you sign in, so it can't be removed." : e.message); }
    }}>Remove this number</button>
  </section>`;
}

function addPhoneSheet() {
  const f = { phone: "", code: "", step: "phone", busy: false, error: null };
  const send = async (e) => {
    e?.preventDefault();
    if (!looksLikePhone(f.phone)) { f.error = "Enter a mobile number like (555) 123-4567."; update(); return; }
    f.busy = true; f.error = null; update();
    try { await state.api.phoneStart(f.phone); f.step = "code"; } catch (err) { f.error = err.message; }
    f.busy = false; update();
  };
  const check = async (e) => {
    e?.preventDefault();
    f.busy = true; f.error = null; update();
    try { await state.api.phoneVerify(f.phone, f.code); closeSheet(); invalidate("me:phone"); toast("Mobile number added."); }
    catch (err) { f.busy = false; f.error = err.message; update(); }
  };
  openSheet(() => f.step === "phone"
    ? html`<form class="stack" @submit=${send}>
        <h2>Add your mobile number</h2>
        <div class="field"><label for="ph">Mobile number</label>
          <input id="ph" class="input" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="(555) 123-4567" @input=${(e) => (f.phone = e.target.value)} /></div>
        ${f.error ? html`<p class="small" style="color:var(--urgent-ink)">${f.error}</p>` : nothing}
        <button class="btn primary block" ?disabled=${f.busy} type="submit">${f.busy ? "Sending…" : "Text me a code"}</button>
        <p class="small muted">Message & data rates may apply.</p>
      </form>`
    : html`<form class="stack" @submit=${check}>
        <h2>Check your texts</h2>
        <p class="ink-2">We texted a 6-digit code to <b>${formatPhone(f.phone)}</b>.</p>
        <input class="input code-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••"
          @input=${(e) => { f.code = e.target.value.replace(/\D/g, "").slice(0, 6); if (f.code.length === 6) check(); }} />
        ${f.error ? html`<p class="small" style="color:var(--urgent-ink)">${f.error}</p>` : nothing}
        <button class="btn primary block" ?disabled=${f.busy} type="submit">${f.busy ? "Checking…" : "Confirm"}</button>
      </form>`);
}
