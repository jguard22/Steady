// Onboarding: name + email → 6-digit code → in. No passwords.
//
//   #/start/<role>            wearer | family | clinician, no invite
//   #/join?code=&e=&n=        from an invite (link or typed code)
//   #/code?e=&c=&i=           the "Open Steady" button in the code email
//
// An invite is carried through every step: the code email names the person
// who invited you, and checking the code joins their circle in the same call.
import { html, nothing } from "../../vendor/lit.js";
import { state, set, update, go, toast } from "../app/state.js";
import { startSession, ROLE_HOME } from "../app/session.js";
import { icon, mark } from "../ui/icons.js";
import { auth, previewInvite, normalizeCode, authOptions, formatPhone, looksLikePhone } from "../cloud/auth.js";
import { kv, prefs } from "../store/kv.js";
import { signIn as passwordSignIn } from "./welcome.js";

const ROLE_TEXT = {
  wearer: { title: "Let's get you set up", lead: "Steady learns how you usually walk and stand, and lets the people you choose know if something changes." },
  family: { title: "Look out for someone", lead: "See how they're doing day to day, and get a message if something needs you." },
  clinician: { title: "Steady for clinicians", lead: "Everyday gait and balance for the people who share it with you." },
};

let O = null; // onboarding state, survives re-renders

let OPTS = null; // {email, sms, voice} from the cloud
authOptions().then((o) => { OPTS = o; if (O && !O.methodChosen) O.method = o.sms ? "sms" : "email"; update(); });

function fresh(over = {}) {
  return { step: "email", role: "wearer", invite: null, preview: null, previewLoaded: false, method: OPTS?.sms ? "sms" : "email", methodChosen: false,
    email: "", phone: "", name: "", code: "", busy: false, error: null, resendAt: 0, channel: "sms", ...over };
}

function remember() {
  prefs.set("onboard", { role: O.role, invite: O.invite, email: O.email, name: O.name, method: O.method, phone: O.phone });
}

// ---------- entry points ----------
export function startView(role) {
  if (!O || O.invite || O.role !== role) O = fresh({ role: ["wearer", "family", "clinician"].includes(role) ? role : "wearer" });
  return screen();
}

export function joinView() {
  const q = state.route.query;
  const code = normalizeCode(q.code ?? "");
  if (!O || O.invite !== (code || null)) {
    O = fresh({ role: "family", invite: code || null, email: q.e ?? "", name: q.n ?? "" });
    if (q.e) { O.method = "email"; O.methodChosen = true; }
    if (code) loadPreview(code);
  }
  // Already signed in: one tap to join.
  if (state.mode === "cloud" && O.invite) return joinSignedIn();
  return screen();
}

export function codeLinkView() {
  const q = state.route.query;
  if (!O || O.step !== "verifying-link") {
    const saved = prefs.get("onboard", {}) ?? {};
    O = fresh({ step: "verifying-link", method: "email", methodChosen: true, email: q.e ?? saved.email ?? "", code: q.c ?? "", invite: normalizeCode(q.i ?? saved.invite ?? "") || null, role: saved.role ?? "wearer", name: saved.name ?? "" });
    queueMicrotask(verify);
  }
  return shell(html`<div class="center stack" style="padding:40px 0">
    ${O.error ? html`<h2>That link didn't work</h2><p class="ink-2">${O.error}</p>
      <button class="btn primary block" @click=${() => { O.step = "email"; O.error = null; go(O.invite ? `#/join?code=${O.invite}&e=${encodeURIComponent(O.email)}` : `#/start/${O.role}`); }}>Send a new code</button>`
      : html`<h2>Signing you in…</h2><p class="ink-2">One moment.</p>`}
  </div>`);
}

async function loadPreview(code) {
  const p = await previewInvite(code);
  if (!O || O.invite !== code) return;
  O.preview = p; O.previewLoaded = true;
  if (p?.role) O.role = p.role === "clinician" ? "clinician" : "family";
  update();
}

// ---------- screens ----------
function shell(body) {
  return html`<div class="welcome">
    <div class="row">${mark("logo-xl")}<span class="grow"></span>
      <a class="btn small ghost" href="#/welcome" @click=${() => { O = null; }}>${icon("chevronLeft")} Back</a></div>
    ${body}
  </div>`;
}

function screen() {
  if (O.step === "code") return shell(codeStep());
  return shell(emailStep());
}

function inviteHeading() {
  if (!O.invite) return nothing;
  if (!O.previewLoaded) return html`<p class="muted">Checking your invite…</p>`;
  if (!O.preview) return html`<div class="banner" style="background:var(--watch-soft);color:var(--watch-ink)">${icon("info")}<span>This invite has expired or was already used. Ask for a new one — you can still create your account now.</span></div>`;
  const who = O.preview.wearerName || "Someone";
  return html`<div class="stack-sm">
    <span class="pill brand" style="justify-self:start">${icon("heart")} You're invited</span>
    <h1>${who} invited you to their Steady circle</h1>
    <p class="ink-2">${O.preview.role === "clinician"
      ? `You'll see ${who}'s everyday walking and balance measures and changes from their usual.`
      : `You'll see how ${who} is doing day to day, and get a message if something needs you.`}</p>
  </div>`;
}

function emailStep() {
  const t = ROLE_TEXT[O.role] ?? ROLE_TEXT.wearer;
  const sms = O.method === "sms";
  const submit = (e) => { e?.preventDefault(); sendCode(); };
  const switchTo = (m) => { O.method = m; O.methodChosen = true; O.error = null; update(); setTimeout(() => document.getElementById(m === "sms" ? "ob-phone" : "ob-email")?.focus(), 30); };
  return html`
    ${O.invite ? inviteHeading() : html`<div class="stack-sm"><h1>${t.title}</h1><p class="ink-2">${t.lead}</p></div>`}
    <form class="stack" @submit=${submit}>
      <div class="field"><label for="ob-name">${O.role === "wearer" ? "Your first name" : "Your name"}</label>
        <input id="ob-name" class="input" autocomplete="given-name" .value=${O.name} @input=${(e) => (O.name = e.target.value)}
          placeholder=${O.role === "clinician" ? "e.g. Dr. Rivera" : "e.g. Dana"} /></div>
      ${sms
        ? html`<div class="field"><label for="ob-phone">Your mobile number</label>
            <input id="ob-phone" class="input" type="tel" inputmode="tel" autocomplete="tel-national" required .value=${O.phone}
              @input=${(e) => (O.phone = e.target.value)} placeholder="(555) 123-4567" /></div>`
        : html`<div class="field"><label for="ob-email">Your email</label>
            <input id="ob-email" class="input" type="email" inputmode="email" autocomplete="email" required .value=${O.email}
              @input=${(e) => (O.email = e.target.value)} placeholder="you@example.com" /></div>`}
      ${O.error ? html`<p class="small" style="color:var(--urgent-ink)" role="alert">${O.error}</p>` : nothing}
      <button class="btn primary block" style="min-height:64px;font-size:1.1em" ?disabled=${O.busy} type="submit">${O.busy ? "Sending…" : html`${icon("message")} ${sms ? "Text me a code" : "Email me a code"}`}</button>
    </form>
    <p class="small muted center">${sms ? "No password needed. We'll text you a 6-digit code. Message & data rates may apply." : "No password needed. We'll email you a 6-digit code — that's it."}</p>
    ${OPTS?.sms ? html`<button class="btn ghost small" style="justify-self:center" @click=${() => switchTo(sms ? "email" : "sms")}>${sms ? "Use my email instead" : "Use my mobile number instead"}</button>` : nothing}
    <div class="divider"></div>
    <button class="btn ghost small" style="justify-self:center" @click=${() => { prefs.set("pendingJoin", O.invite); passwordSignIn(O.role); }}>I already have a BrilliantWear password</button>
    ${!O.invite && O.role === "wearer" ? html`<button class="btn ghost small" style="justify-self:center" @click=${() => startSession({ role: "wearer", mode: "local" })}>Skip for now — keep my data on this device</button>` : nothing}
  `;
}

function codeStep() {
  const wait = Math.max(0, Math.ceil((O.resendAt - Date.now()) / 1000));
  if (wait > 0) setTimeout(update, 1000);
  const onInput = (e) => {
    O.code = e.target.value.replace(/\D/g, "").slice(0, 6);
    e.target.value = O.code;
    if (O.code.length === 6 && !O.busy) verify();
  };
  return html`
    <div class="stack-sm">
      <h1>${O.method === "sms" ? (O.channel === "call" ? "We're calling you" : "Check your texts") : "Check your email"}</h1>
      <p class="ink-2">${O.method === "sms"
        ? O.channel === "call"
          ? html`Your phone will ring at <b class="nowrap">${formatPhone(O.phone)}</b> and a voice will read a 6-digit code. Type it below.`
          : html`We texted a 6-digit code to <b class="nowrap">${formatPhone(O.phone)}</b>. It usually arrives within a minute.`
        : html`We sent a 6-digit code to <b>${O.email}</b>. It can take a minute to arrive — check spam if you don't see it.`}</p>
    </div>
    <div class="field">
      <label for="ob-code">Code</label>
      <input id="ob-code" class="input code-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*"
        .value=${O.code} @input=${onInput} placeholder="••••••" autofocus />
    </div>
    ${O.error ? html`<p class="small" style="color:var(--urgent-ink)" role="alert">${O.error}</p>` : nothing}
    <button class="btn primary block" style="min-height:64px;font-size:1.1em" ?disabled=${O.busy || O.code.length !== 6} @click=${verify}>${O.busy ? "Checking…" : O.invite && O.preview ? `Join ${O.preview.wearerName}'s circle` : "Continue"}</button>
    <p class="small muted center">${O.method === "sms" ? "On a phone, the code often appears just above the keyboard — tap it." : "On a phone, the code often appears just above the keyboard — tap it. Or tap “Open Steady” in the email."}</p>
    <div class="row wrap" style="justify-content:center;gap:4px">
      <button class="btn ghost small" ?disabled=${wait > 0 || O.busy} @click=${() => { O.channel = "sms"; sendCode(); }}>${wait > 0 ? `Send again in ${wait}s` : O.method === "sms" ? "Text me a new code" : "Send a new code"}</button>
      ${O.method === "sms" && OPTS?.voice && wait === 0 ? html`<button class="btn ghost small" ?disabled=${O.busy} @click=${() => { O.channel = "call"; sendCode(); }}>${icon("phone")} Call me with the code</button>` : nothing}
      <button class="btn ghost small" @click=${() => { O.step = "email"; O.code = ""; O.error = null; O.channel = "sms"; update(); }}>${O.method === "sms" ? "Use a different number" : "Use a different email"}</button>
    </div>`;
}

function joinSignedIn() {
  const who = O.preview?.wearerName ?? "them";
  return shell(html`
    ${inviteHeading()}
    ${O.error ? html`<p class="small" style="color:var(--urgent-ink)" role="alert">${O.error}</p>` : nothing}
    <button class="btn primary block" style="min-height:64px" ?disabled=${O.busy || (O.previewLoaded && !O.preview)} @click=${async () => {
      O.busy = true; O.error = null; update();
      try {
        const r = await state.api.accept(O.invite);
        O = null;
        toast(`You're now in ${r.wearer?.displayName || who}'s circle.`);
        go(state.role === "clinician" ? `#/patient/${r.link?.wearerId ?? r.wearer?.id}/overview` : `#/p/${r.wearer?.id ?? r.link?.wearerId}`);
      } catch (e) {
        O.busy = false; O.error = e.message; update();
      }
    }}>${icon("check")} Join ${who}'s circle</button>`);
}

// ---------- actions ----------
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function sendCode() {
  const sms = O.method === "sms";
  if (sms && !looksLikePhone(O.phone)) { O.error = "Enter your mobile number, like (555) 123-4567."; update(); return; }
  if (!sms && !EMAIL.test(O.email.trim())) { O.error = "Enter your email address, like name@example.com."; update(); return; }
  O.busy = true; O.error = null; update();
  try {
    const r = sms ? await auth.phoneStart(O.phone, O.invite, O.channel) : await auth.emailStart(O.email, O.invite);
    if (r.invite && !O.preview) { O.preview = r.invite; O.previewLoaded = true; }
    remember();
    O.step = "code"; O.code = ""; O.resendAt = Date.now() + 30000;
  } catch (e) {
    if (e.code === "sms_unavailable" || e.code === "sms_failed") { O.method = "email"; O.methodChosen = true; O.error = "Text codes aren't working right now — use your email instead."; }
    else if (e.code === "use_email") { O.method = "email"; O.methodChosen = true; O.error = e.message || "For your security, sign in with your email this time."; }
    else O.error = e.message;
  }
  O.busy = false;
  update();
  setTimeout(() => document.getElementById("ob-code")?.focus(), 50);
}

async function verify() {
  if (!O || O.busy) return;
  O.busy = true; O.error = null; update();
  try {
    const args = { code: O.code, invite: O.invite, displayName: O.name || undefined };
    const r = O.method === "sms" ? await auth.phoneVerify({ ...args, phone: O.phone }) : await auth.emailVerify({ ...args, email: O.email });
    const role = r.joined ? (r.joined.role === "clinician" ? "clinician" : "family") : O.role;
    const invite = O.invite, inviteError = r.inviteError;
    O = null;
    prefs.del("onboard"); prefs.del("pendingJoin");
    startSession({ role, mode: "cloud" }, { navigate: false });
    if (role === "wearer") await carryOverLocalData();
    if (r.joined) {
      toast(`Welcome! You're now in ${r.joined.displayName || "their"}'s circle.`);
      go(role === "clinician" ? `#/patient/${r.joined.wearerId}/overview` : `#/p/${r.joined.wearerId}`, { replace: true });
    } else {
      if (invite && inviteError) toast(inviteError, 5000);
      else toast(r.isNew ? "You're all set." : "Welcome back.");
      go(ROLE_HOME[role], { replace: true });
    }
  } catch (e) {
    if (O) {
      O.busy = false;
      O.error = e.message;
      if (e.code === "use_email") { O.method = "email"; O.methodChosen = true; O.step = "email"; O.code = ""; }
      if (O.step === "verifying-link") O.step = "verifying-link";
      update();
    }
  }
}

/** A wearer who started on this device keeps everything they measured. */
async function carryOverLocalData() {
  try {
    const local = await kv.get("local-db");
    const days = local?.days ?? [];
    for (let i = 0; i < days.length; i += 31) await state.api.putDays(days.slice(i, i + 31));
    for (const c of local?.checks ?? []) await state.api.postCheck({ takenAt: c.takenAt, results: c.results, summary: c.summary ?? { score: c.score } });
    if (days.length || local?.checks?.length) toast(`Moved ${days.length} day${days.length === 1 ? "" : "s"} of your data to your account.`);
  } catch { /* stays on the device; nothing lost */ }
}
