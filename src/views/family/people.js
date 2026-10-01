import { html, nothing } from "../../../vendor/lit.js";
import { state, load } from "../../app/state.js";
import { icon } from "../../ui/icons.js";
import { pill, avatar, ago, minutesText, fmtNum, empty } from "../../ui/components.js";

export function peopleList() {
  const r = load("people", () => state.api.people(), { ttl: 30000 });
  if (r.data) state.topAlerts = r.data.reduce((a, p) => a + (p.openAlerts ?? 0), 0);
  return r;
}

export function peopleView() {
  const r = peopleList();
  if (!r.data) return html`<div class="card" style="height:200px"></div>`;
  const people = r.data;
  if (!people.length) {
    return html`<h1>People you look out for</h1>
      ${empty("userPlus", "No one yet", "Ask the person who wears the insoles to invite you from their Circle screen. They'll give you an 8-character code.",
        html`<a class="btn primary" href="#/join">Enter an invite code</a>`)}`;
  }
  return html`
    <h1>People you look out for</h1>
    <div class="stack-sm">${people.map(personCard)}</div>
    <a class="btn block" href="#/join">${icon("userPlus")} Join another circle</a>
  `;
}

export function personCard(p) {
  return html`<a class="card card-link stack-sm" href=${`#/p/${p.wearerId}`}>
    <div class="row">
      ${avatar(p.displayName)}
      <div class="grow"><b>${p.displayName}</b><div class="small muted">${p.lastSeen ? `Insoles last used ${ago(p.lastSeen)}` : "No insole data yet"}</div></div>
      ${p.urgent ? pill("urgent", "Needs you") : pill(p.status)}
    </div>
    ${p.notes?.length && p.status !== "steady" ? html`<p class="small ink-2">${p.notes[0].text}.</p>` : nothing}
    ${p.today && p.today.steps != null ? html`<div class="row small muted" style="gap:8px">${icon("walk")} ${minutesText(p.today.walkMin)} walking today · ${fmtNum(p.today.steps)} steps</div>` : nothing}
  </a>`;
}
