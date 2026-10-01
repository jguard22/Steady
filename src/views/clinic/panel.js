// Clinician panel: everyone in one triage list, most in need first.
import { html, nothing } from "../../../vendor/lit.js";
import { state, update } from "../../app/state.js";
import { icon } from "../../ui/icons.js";
import { pill, avatar, ago, nonClinical } from "../../ui/components.js";
import { sparkline } from "../../ui/charts.js";
import { BY_KEY } from "../../engine/baseline.js";
import { peopleList } from "../family/people.js";
import { DEMO_IDENTITIES } from "../../cloud/demo-api.js";

const RANK = { review: 1, watch: 2, nodata: 3, steady: 4, learning: 5 };
let filter = "all";
let query = "";

export function panelView() {
  const r = peopleList();
  if (!r.data) return html`<div class="card" style="height:300px"></div>`;
  const all = [...r.data].sort((a, b) => (b.urgent - a.urgent) || (RANK[a.status] - RANK[b.status]) || ((b.topChange?.ewma ?? 0) - (a.topChange?.ewma ?? 0)));
  const dayOfMonth = new Date().getDate();
  const counts = {
    all: all.length,
    review: all.filter((p) => p.urgent || p.status === "review" || p.status === "watch").length,
    alerts: all.filter((p) => p.openAlerts > 0).length,
    data: all.filter((p) => p.daysWithData < Math.min(16, dayOfMonth - 1)).length,
  };
  const shown = all.filter((p) => {
    if (query && !p.displayName.toLowerCase().includes(query.toLowerCase())) return false;
    if (filter === "review") return p.urgent || p.status === "review" || p.status === "watch";
    if (filter === "alerts") return p.openAlerts > 0;
    if (filter === "data") return p.daysWithData < Math.min(16, dayOfMonth - 1);
    return true;
  });
  const practice = state.mode === "demo" ? DEMO_IDENTITIES.CLINICIAN : null;
  return html`
    <div class="clinic-head">
      <div class="grow"><h1>Patients</h1><div class="muted">${practice ? `${practice.displayName} · ${practice.practice}` : "Your Steady panel"}</div></div>
      <a class="btn small" href="#/join">${icon("userPlus")} Add with invite code</a>
    </div>
    <div class="grid-4" style="margin-bottom:16px">
      ${statCard("Need a look", counts.review, "status changed or urgent alert", "review")}
      ${statCard("Open alerts", counts.alerts, "across your panel", "alerts")}
      ${statCard("Behind on data", counts.data, "fewer days than expected this month", "data")}
      ${statCard("Patients", counts.all, "sharing with you", "all")}
    </div>
    <div class="filters">
      ${[["all", "All"], ["review", "Needs a look"], ["alerts", "Alerts"], ["data", "Behind on data"]].map(([k, l]) => html`<button class="chip" aria-pressed=${filter === k ? "true" : "false"} @click=${() => { filter = k; update(); }}>${l}<span class="count">${counts[k]}</span></button>`)}
      <span class="grow"></span>
      <label class="row" style="gap:6px">${icon("search")}<input class="input" style="min-height:36px;width:200px" placeholder="Search" aria-label="Search patients" .value=${query} @input=${(e) => { query = e.target.value; update(); }} /></label>
    </div>
    <div class="table-wrap"><table class="data">
      <thead><tr><th>Patient</th><th>Status</th><th>Biggest change</th><th>Cadence, 5 wk</th><th class="num">Check</th><th>Days with data</th><th class="num">Minutes</th><th>Data</th></tr></thead>
      <tbody>${shown.map(row)}</tbody>
    </table></div>
    <p class="footnote" style="margin-top:12px">Days with data and logged minutes are counted per calendar month to support remote-monitoring programs. ${state.api.nonClinical}</p>
  `;
}

function statCard(label, n, sub, key) {
  return html`<button class="card" style="text-align:left;cursor:pointer;${filter === key ? "border-color:var(--brand)" : ""}" @click=${() => { filter = key; update(); }}>
    <div class="stat"><span class="label">${label}</span><span class="value">${n}</span><span class="small muted">${sub}</span></div></button>`;
}

function row(p) {
  const tc = p.topChange;
  const def = tc ? BY_KEY[tc.key] : null;
  const days = p.daysWithData ?? 0;
  return html`<tr class="clickable" tabindex="0" @click=${() => (location.hash = `#/patient/${p.wearerId}/overview`)} @keydown=${(e) => e.key === "Enter" && (location.hash = `#/patient/${p.wearerId}/overview`)}>
    <td><div class="row" style="gap:10px">${avatar(p.displayName)}<div><b>${p.displayName}</b><div class="small muted">${p.age ? `${p.age} · ` : ""}${(p.tags ?? []).join(", ")}</div></div></div></td>
    <td>${p.urgent ? pill("urgent", "Urgent alert") : pill(p.status)}</td>
    <td>${def ? html`<b style="font-weight:650">${def.label}</b><div class="small"><span class="delta ${tc.level === "review" ? "worse" : "worse"}">${tc.changePct != null ? `${tc.changePct > 0 ? "+" : ""}${tc.changePct.toFixed(0)}%` : `${tc.ewma?.toFixed(1)}σ`}</span></div>` : html`<span class="muted small">—</span>`}</td>
    <td>${p.cadenceTrend ? sparkline(p.cadenceTrend, { w: 110 }) : nothing}</td>
    <td class="num">${p.latestCheck ?? "—"}</td>
    <td><div class="row" style="gap:8px"><div class="zbar" style="width:70px;height:8px"><span class="fill ${days >= 16 ? "better" : "same"}" style="left:0;width:${Math.min(100, (days / 16) * 100)}%"></span></div><span class="small num">${days} d${days >= 16 ? " ✓" : ""}</span></div></td>
    <td class="num">${p.minutesLogged ?? 0}</td>
    <td class="small muted">${ago(p.lastSeen)}</td>
  </tr>`;
}
