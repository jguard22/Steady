// Alerts inbox: the wearer's own alerts, or everyone a watcher follows.
import { html, nothing } from "../../vendor/lit.js";
import { state, load } from "../app/state.js";
import { icon } from "../ui/icons.js";
import { pill, fmtDateTime, empty, avatar } from "../ui/components.js";
import { mySummary } from "./wearer/today.js";

export function alertsView() {
  if (state.role === "wearer") {
    const s = mySummary();
    if (!s.data) return html`<div class="card" style="height:200px"></div>`;
    const alerts = s.data.alerts ?? [];
    return html`<h1>Alerts</h1>
      <p class="muted">What Steady has shared with your circle.</p>
      ${alerts.length ? html`<div class="list">${alerts.map((a) => row(a))}</div>` : empty("bell", "Nothing here", "When Steady notices something your circle should know, it shows up here too.")}`;
  }
  const r = load("alerts:all", async () => {
    const people = await state.api.people();
    const sums = await Promise.all(people.filter((p) => p.scopes.includes("alerts")).map((p) => state.api.personSummary(p.wearerId).then((s) => ({ p, s }))));
    return sums.flatMap(({ p, s }) => (s.alerts ?? []).map((a) => ({ ...a, person: p }))).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, { ttl: 20000 });
  if (!r.data) return html`<div class="card" style="height:200px"></div>`;
  const open = r.data.filter((a) => a.status === "open");
  const rest = r.data.filter((a) => a.status !== "open").slice(0, 30);
  const link = (a) => (state.role === "clinician" ? `#/patient/${a.person.wearerId}/overview` : `#/p/${a.person.wearerId}`);
  return html`<h1>Alerts</h1>
    ${open.length ? html`<h2 class="section-title">Open</h2><div class="list">${open.map((a) => row(a, link(a)))}</div>` : empty("checkCircle", "All clear", "No open alerts right now.")}
    ${rest.length ? html`<h2 class="section-title">Earlier</h2><div class="list">${rest.map((a) => row(a, link(a)))}</div>` : nothing}`;
}

function row(a, href) {
  const level = a.status === "open" ? (a.severity === "info" ? "info" : a.severity) : "steady";
  const inner = html`${a.person ? avatar(a.person.displayName) : html`<span class="avatar">${icon(a.severity === "urgent" ? "alert" : "bell")}</span>`}
    <div class="grow"><b style="font-weight:650">${a.person ? `${a.person.displayName}: ` : ""}${a.title}</b>
      ${a.detail?.notes?.length ? html`<div class="small ink-2">${a.detail.notes.join(" · ")}</div>` : nothing}
      <div class="small muted">${fmtDateTime(a.createdAt)}${a.ackBy ? ` · seen by ${a.ackBy}` : ""}${a.ackNote ? ` — “${a.ackNote}”` : ""}</div></div>
    ${pill(level, a.status === "open" ? (a.severity === "urgent" ? "Urgent" : a.severity === "info" ? "Info" : "New") : a.status === "acked" ? "Seen" : "Resolved")}`;
  return href ? html`<a href=${href}>${inner}</a>` : html`<div class="row">${inner}</div>`;
}
