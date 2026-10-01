import { html, nothing } from "../../../vendor/lit.js";
import { state } from "../../app/state.js";
import { icon } from "../../ui/icons.js";
import { nonClinical, fmtDate } from "../../ui/components.js";
import { activityRings, walkingSection, balanceSection, strikeSection, trendCard } from "../shared/metrics.js";
import { mySummary, errorCard } from "./today.js";

const SECTIONS = [
  ["activity", "Activity"],
  ["walking", "Walking"],
  ["balance", "Balance"],
  ["steps", "Foot strike"],
];

export function myDataView(section = "activity") {
  const s = mySummary();
  if (!s.data) return s.status === "error" ? errorCard(s.error) : html`<div class="card" style="height:300px"></div>`;
  const { days, evaluation, events } = s.data;
  const date = state.route.query.date ?? days[days.length - 1]?.date;
  return html`
    <h1>My data</h1>
    <p class="muted">The last five weeks, with your usual shaded in.</p>
    <div class="segmented" role="tablist" style="overflow-x:auto;max-width:100%">
      ${SECTIONS.map(([k, label]) => html`<button role="tab" aria-pressed=${section === k ? "true" : "false"} @click=${() => (location.hash = `#/data/${k}`)}>${label}</button>`)}
    </div>
    ${section === "activity" ? html`
      <section class="card stack-sm">
        <div class="card-head" style="margin-bottom:0"><h3>Activity & time on your feet</h3>
          <select class="input" style="width:auto;min-height:40px" aria-label="Day" @change=${(e) => (location.hash = `#/data/activity?date=${e.target.value}`)}>
            ${days.slice(-7).reverse().map((d) => html`<option value=${d.date} ?selected=${d.date === date}>${fmtDate(d.date, { weekday: "short", month: "short", day: "numeric" })}</option>`)}
          </select></div>
        ${activityRings(days, date)}
      </section>
      ${trendCard("walkMin", days, evaluation, events, { title: "Walking time", sub: "minutes per day", kind: "bars", audience: "wearer" })}
      ${trendCard("steps", days, evaluation, events, { title: "Steps", sub: "per day", kind: "bars", audience: "wearer" })}
    ` : nothing}
    ${section === "walking" ? walkingSection(days, evaluation, events, { audience: "wearer" }) : nothing}
    ${section === "balance" ? balanceSection(days, evaluation, events, { audience: "wearer" }) : nothing}
    ${section === "steps" ? strikeSection(days, { audience: "wearer" }) : nothing}
    <div class="row">${icon("info")}<p class="small muted">Measured from everyday life — not from a test — so a busy or quiet day can move things a little. Steady only points out changes that last.</p></div>
    ${nonClinical(s.data.nonClinical)}
  `;
}
