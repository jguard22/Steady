// The wearer's care circle: who sees what, invites, removal.
import { html, nothing } from "../../../vendor/lit.js";
import { state, load, invalidate, openSheet, closeSheet, toast, update } from "../../app/state.js";
import { icon } from "../../ui/icons.js";
import { avatar, fmtDate, empty } from "../../ui/components.js";
import { SCOPES, SCOPE_TEXT } from "../../cloud/summary.js";

export function circleView() {
  const r = load("me:circle", () => state.api.circle(), { ttl: 20000 });
  if (!r.data) return html`<div class="card" style="height:200px"></div>`;
  const { members = [], invites = [], needSignIn } = r.data;
  return html`
    <h1>Your circle</h1>
    <p class="ink-2">The people who look out for you. Each sees only what you choose, and you can change it any time.</p>
    ${needSignIn ? html`<section class="card stack-sm">
      <h3>Sign in to share</h3>
      <p class="small ink-2">Right now your Steady data stays on this device. Sign in with a BrilliantWear account to invite family or your clinician.</p>
      <a class="btn primary" href="#/start/wearer">${icon("message")} Sign in with my email</a>
    </section>` : nothing}
    ${members.length ? html`<div class="stack-sm">${members.map(memberCard)}</div>` : !needSignIn ? empty("people", "No one yet", "Invite a family member or your clinician. They'll get a code to join.") : nothing}
    ${invites.length ? html`<h2 class="section-title">Waiting to join</h2><div class="list">${invites.map((i) => html`<div class="row">
      <span class="avatar">${icon("clock")}</span>
      <div class="grow"><b>${i.label ? `${i.label} · ` : ""}${i.role === "clinician" ? "clinician" : "family"} invite${i.code ? html` · <span class="num" style="letter-spacing:.12em">${fmtCode(i.code)}</span>` : nothing}</b><div class="small muted">Expires ${fmtDate(i.expiresAt.slice(0, 10))}</div></div>
      <button class="btn small ghost" @click=${async () => { await state.api.revoke(i.id); invalidate("me:circle"); }}>Cancel</button></div>`)}</div>` : nothing}
    ${!needSignIn ? html`<div class="grid-2" style="grid-template-columns:1fr 1fr">
      <button class="btn primary block" @click=${() => invite("family")}>${icon("userPlus")} Invite family</button>
      <button class="btn block" @click=${() => invite("clinician")}>${icon("stethoscope")} Invite clinician</button>
    </div>` : nothing}
  `;
}

const fmtCode = (c) => (c ? `${c.slice(0, 4)}-${c.slice(4)}` : "");

function memberCard(m) {
  return html`<section class="card stack-sm">
    <div class="row wrap">${avatar(m.name)}<div class="grow" style="min-width:160px"><b>${m.name}</b><div class="small muted">${m.role === "clinician" ? "Clinician" : "Family"} · since ${fmtDate(m.acceptedAt)}</div></div>
      <button class="btn small" @click=${() => editScopes(m)}>${icon("sliders")} What they see</button></div>
    <p class="small muted">${m.scopes.map((s) => SCOPE_TEXT[s].split(",")[0]).join(" · ")}</p>
  </section>`;
}

function editScopes(m) {
  const chosen = new Set(m.scopes);
  openSheet(() => html`<div class="stack">
    <h2>What ${m.name.split(" ")[0]} sees</h2>
    <div class="stack-sm">${SCOPES.filter((s) => m.role === "clinician" || s !== "program").map((s) => html`<label class="row between card flat" style="padding:12px 14px">
      <span>${SCOPE_TEXT[s]}</span>
      <span class="switch"><input type="checkbox" .checked=${chosen.has(s)} ?disabled=${s === "status"} @change=${(e) => (e.target.checked ? chosen.add(s) : chosen.delete(s))} /><span></span></span>
    </label>`)}</div>
    <button class="btn primary block" @click=${async () => { await state.api.setScopes(m.id, [...chosen]).catch(() => {}); closeSheet(); invalidate("me:circle"); toast("Saved."); }}>Save</button>
    <button class="btn ghost block" style="color:var(--urgent-ink)" @click=${async () => { await state.api.revoke(m.id).catch(() => {}); closeSheet(); invalidate("me:circle"); toast(`${m.name} removed from your circle.`); }}>Remove ${m.name.split(" ")[0]} from my circle</button>
  </div>`);
}

function invite(role) {
  const f = { role, name: "", email: "", busy: false, error: null };
  const send = async (e) => {
    e?.preventDefault();
    if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) { f.error = "That email doesn't look right."; update(); return; }
    f.busy = true; f.error = null; update();
    let inv;
    try { inv = await state.api.invite(f.role, { name: f.name.trim() || undefined, email: f.email.trim() || undefined }); }
    catch (err) { f.busy = false; f.error = err.message; update(); return; }
    invalidate("me:circle");
    sent(inv, f);
  };
  openSheet(() => html`<form class="stack" @submit=${send}>
    <h2>Invite someone</h2>
    <div class="segmented" role="group" aria-label="Who">
      <button type="button" aria-pressed=${f.role === "family" ? "true" : "false"} @click=${() => { f.role = "family"; update(); }}>Family or friend</button>
      <button type="button" aria-pressed=${f.role === "clinician" ? "true" : "false"} @click=${() => { f.role = "clinician"; update(); }}>Clinician</button>
    </div>
    <div class="field"><label for="inv-name">Their name</label>
      <input id="inv-name" class="input" autocomplete="off" placeholder=${f.role === "clinician" ? "e.g. Dr. Rivera" : "e.g. Dana"} @input=${(e) => (f.name = e.target.value)} /></div>
    <div class="field"><label for="inv-email">Their email <span class="muted">(Steady sends the invite for you)</span></label>
      <input id="inv-email" class="input" type="email" inputmode="email" autocomplete="off" placeholder="name@example.com" @input=${(e) => (f.email = e.target.value)} /></div>
    ${f.error ? html`<p class="small" style="color:var(--urgent-ink)" role="alert">${f.error}</p>` : nothing}
    <button class="btn primary block" ?disabled=${f.busy} type="submit">${f.busy ? "Sending…" : html`${icon("userPlus")} Send invite`}</button>
    <p class="small muted">They'll get a link and a code. No password needed — they just confirm their email. ${f.role === "clinician" ? "Your clinician sees detailed measures; you can change this later." : "Family sees how you're doing and alerts; you can change this later."}</p>
  </form>`);
}

function sent(inv, f) {
  const link = `${location.origin}${location.pathname}#/join?code=${inv.code}${f.email ? `&e=${encodeURIComponent(f.email.trim())}` : ""}${f.name ? `&n=${encodeURIComponent(f.name.trim())}` : ""}`;
  const who = f.name.trim() || (f.role === "clinician" ? "your clinician" : "them");
  const text = `Join my Steady circle so you can see how I'm doing: ${link} (no password needed — or enter code ${fmtCode(inv.code)} in Steady)`;
  openSheet(() => html`<div class="stack center">
    <span class="avatar lg" style="margin:0 auto;background:var(--good-soft);color:var(--good-ink)">${icon(inv.emailed ? "check" : "userPlus")}</span>
    <h2>${inv.emailed ? `Invite sent to ${who}` : `Share this with ${who}`}</h2>
    <p class="ink-2">${inv.emailed ? `We emailed ${f.email.trim()} a link to join. You can also text it to them:` : "Send them this link or code. It works once and expires in 7 days."}</p>
    <div class="card tinted" style="font-size:2em;font-weight:800;letter-spacing:.18em">${fmtCode(inv.code)}</div>
    <a class="btn primary block" href=${`sms:?&body=${encodeURIComponent(text)}`}>${icon("message")} Send as a text</a>
    ${navigator.share ? html`<button class="btn block" @click=${() => navigator.share({ title: "Join my Steady circle", text }).catch(() => {})}>${icon("share")} Share another way</button>` : nothing}
    <button class="btn ghost block" @click=${closeSheet}>Done</button>
  </div>`);
}
