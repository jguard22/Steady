import { html, nothing } from "../../vendor/lit.js";
import { state, set, openSheet, closeSheet, toast, go } from "../app/state.js";
import { startSession, ROLE_HOME } from "../app/session.js";
import { icon, mark } from "../ui/icons.js";
import { auth, inHub } from "../cloud/auth.js";
import { prefs } from "../store/kv.js";
import { NON_CLINICAL } from "../cloud/summary.js";

const ROLES = [
  { role: "wearer", ic: "foot", title: "I wear the insoles", body: "See how you're moving, do a quick weekly check, and keep your family in the loop." },
  { role: "family", ic: "heart", title: "I look out for someone", body: "For family and caregivers: know they're OK today and what changed this week." },
  { role: "clinician", ic: "stethoscope", title: "I'm a clinician", body: "Everyday gait and balance for your patients, with change alerts and monthly time logs." },
];

export function welcomeView() {
  return html`<div class="welcome">
    <div class="stack" style="justify-items:start">
      ${mark("logo-xl")}
      <h1>Steady <span class="muted" style="font-size:.5em;font-weight:650;letter-spacing:0">by BrilliantWear</span></h1>
      <p class="ink-2" style="font-size:1.15em">Walk with confidence. Steady learns how you usually move from your BrilliantWear insoles — and quietly lets the right people know when something changes.</p>
    </div>
    <div class="stack-sm">
      <h2 style="font-size:1.1em">Who's using Steady?</h2>
      ${ROLES.map((r) => html`<button class="role-card" @click=${() => choose(r.role)}>
        <span class="badge-icon">${icon(r.ic)}</span>
        <span class="grow"><b>${r.title}</b><span class="muted small">${r.body}</span></span>
        ${icon("chevronRight")}
      </button>`)}
    </div>
    <div class="card tinted stack-sm">
      <div class="row">${icon("sparkles")}<b>Just looking?</b></div>
      <p class="small ink-2">Explore Steady with made-up sample data — no insoles or account needed.</p>
      <div class="row wrap">
        <button class="btn small" @click=${() => startSession({ role: "wearer", mode: "demo" })}>Wearer demo</button>
        <button class="btn small" @click=${() => startSession({ role: "family", mode: "demo" })}>Family demo</button>
        <button class="btn small" @click=${() => startSession({ role: "clinician", mode: "demo" })}>Clinician demo</button>
      </div>
    </div>
    <p class="footnote">${NON_CLINICAL} Steady works alongside your other BrilliantWear apps and only uses what you allow.</p>
  </div>`;
}

function choose(role) {
  openSheet(() => html`<div class="stack">
    <h2>${ROLES.find((r) => r.role === role).title}</h2>
    ${role === "wearer"
      ? html`<p class="ink-2">Sign in to share with family or your clinician. You can also start on this device and sign in later.</p>`
      : html`<p class="ink-2">Sign in with the BrilliantWear account you'll use to follow ${role === "family" ? "your family member" : "your patients"}. They'll invite you with a code.</p>`}
    <button class="btn primary block" @click=${() => signIn(role)}>${icon("lock")} Sign in with BrilliantWear</button>
    ${role === "wearer" ? html`<button class="btn block" @click=${() => { closeSheet(); startSession({ role, mode: "local" }); }}>Start on this device</button>` : nothing}
    <button class="btn ghost block" @click=${() => { closeSheet(); startSession({ role, mode: "demo" }); }}>Try the demo instead</button>
    <p class="footnote">Don't have an account? You can create one on the sign-in page. Steady asks only to read and save Steady data.</p>
  </div>`);
}

export async function signIn(role) {
  closeSheet();
  prefs.set("pendingRole", role);
  if (inHub()) {
    set({ signingIn: true });
    go("#/signin");
    try {
      await auth.signIn();
      prefs.del("pendingRole");
      set({ signingIn: false });
      startSession({ role, mode: "cloud" });
    } catch (e) {
      set({ signingIn: false, signInError: e.message === "hub-timeout" ? "The BrilliantWear app didn't answer. Update the app, or open Steady in a browser to sign in." : e.message === "declined" ? "Sign-in was cancelled." : "Sign-in didn't work. Please try again." });
    }
    return;
  }
  auth.signIn().catch(() => toast("Couldn't reach BrilliantWear. Check your connection."));
}

export function signinView() {
  return html`<div class="welcome center">
    <div style="margin:0 auto">${mark("logo-xl")}</div>
    ${state.signingIn
      ? html`<h2>Waiting for the BrilliantWear app…</h2><p class="ink-2">Approve “Steady” in the sheet that just opened.</p>`
      : state.signInError
        ? html`<h2>Not signed in</h2><p class="ink-2">${state.signInError}</p>
           <button class="btn primary" @click=${() => signIn(prefs.get("pendingRole", "wearer"))}>Try again</button>
           <button class="btn ghost" @click=${() => { set({ signInError: null }); go("#/welcome"); }}>Back</button>`
        : html`<h2>Signing in…</h2>`}
  </div>`;
}

export function joinView() {
  const code = state.route.query.code ?? "";
  let value = code;
  const submit = async () => {
    if (!state.api || state.mode !== "cloud") {
      prefs.set("pendingJoin", value);
      openSheet(() => html`<div class="stack">
        <h2>Sign in to join</h2>
        <p class="ink-2">Joining a care circle needs a BrilliantWear account. Steady keeps your code while you sign in.</p>
        <button class="btn primary block" @click=${() => signIn("family")}>${icon("lock")} Sign in as family or caregiver</button>
        <button class="btn block" @click=${() => signIn("clinician")}>${icon("stethoscope")} Sign in as a clinician</button>
      </div>`);
      return;
    }
    try {
      const r = await state.api.accept(value);
      toast(`You're now in ${r.wearer.displayName}'s circle.`);
      go(ROLE_HOME[state.role]);
    } catch (e) {
      toast(e.message || "That code didn't work.");
    }
  };
  return html`<div class="welcome">
    ${mark("logo-xl")}
    <h1>Join a care circle</h1>
    <p class="ink-2">Enter the 8-character code you were given. It works once and expires after 7 days.</p>
    <div class="field"><label for="code">Invite code</label>
      <input id="code" class="input code-input" maxlength="9" autocomplete="one-time-code" .value=${code}
        @input=${(e) => { value = e.target.value; }} @keydown=${(e) => e.key === "Enter" && submit()} /></div>
    <button class="btn primary block" @click=${submit}>Join</button>
    <a class="btn ghost block" href=${state.role ? ROLE_HOME[state.role] : "#/welcome"}>Cancel</a>
  </div>`;
}
