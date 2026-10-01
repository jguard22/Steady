// The wearer's care circle: who sees what, invites, removal.
import { html, nothing } from "../../../vendor/lit.js";
import { state, load, invalidate, openSheet, closeSheet, toast } from "../../app/state.js";
import { icon } from "../../ui/icons.js";
import { avatar, fmtDate, empty } from "../../ui/components.js";
import { SCOPES, SCOPE_TEXT } from "../../cloud/summary.js";
import { signIn } from "../welcome.js";

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
      <button class="btn primary" @click=${() => signIn("wearer")}>${icon("lock")} Sign in</button>
    </section>` : nothing}
    ${members.length ? html`<div class="stack-sm">${members.map(memberCard)}</div>` : !needSignIn ? empty("people", "No one yet", "Invite a family member or your clinician. They'll get a code to join.") : nothing}
    ${invites.length ? html`<h2 class="section-title">Waiting to join</h2><div class="list">${invites.map((i) => html`<div class="row">
      <span class="avatar">${icon("clock")}</span>
      <div class="grow"><b>${i.role === "clinician" ? "Clinician" : "Family"} invite · <span class="num" style="letter-spacing:.12em">${fmtCode(i.code)}</span></b><div class="small muted">Expires ${fmtDate(i.expiresAt.slice(0, 10))}</div></div>
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

async function invite(role) {
  let inv;
  try { inv = await state.api.invite(role); } catch (e) { toast(e.message); return; }
  invalidate("me:circle");
  const link = `${location.origin}${location.pathname}#/join?code=${inv.code}`;
  const text = `Join my Steady circle so you can see how I'm doing. Open ${link} — or enter code ${fmtCode(inv.code)} in Steady.`;
  openSheet(() => html`<div class="stack center">
    <h2>Share this code</h2>
    <p class="ink-2">Give it to your ${role === "clinician" ? "clinician" : "family member"}. It works once and expires in 7 days.</p>
    <div class="card tinted" style="font-size:2em;font-weight:800;letter-spacing:.18em">${fmtCode(inv.code)}</div>
    ${navigator.share ? html`<button class="btn primary block" @click=${() => navigator.share({ title: "Join my Steady circle", text }).catch(() => {})}>${icon("share")} Share</button>` : nothing}
    <a class="btn block" href=${`sms:?&body=${encodeURIComponent(text)}`}>${icon("message")} Send as a text</a>
    <button class="btn ghost block" @click=${closeSheet}>Done</button>
  </div>`);
}
