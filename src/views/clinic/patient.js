// Clinician patient detail.
import { html, nothing } from "../../../vendor/lit.js";
import { state, load, memo, invalidate, toast, openSheet, closeSheet, update } from "../../app/state.js";
import { icon } from "../../ui/icons.js";
import { pill, avatar, ago, fmtDate, fmtDateTime, nonClinical, metricValue } from "../../ui/components.js";
import { monthCalendar } from "../../ui/charts.js";
import { addDays, BY_KEY } from "../../engine/baseline.js";
import { STAGES } from "../../engine/checks.js";
import { summarizeCheck } from "../../engine/checks.js";
import { activityRings, walkingSection, balanceSection, strikeSection, trendCard, changeMap, eventMarks } from "../shared/metrics.js";
import { eventRow, noteSheet } from "../family/person.js";
import { EXERCISES } from "../wearer/exercise.js";

const TABS = [["overview", "Overview"], ["walking", "Walking"], ["balance", "Balance"], ["activity", "Activity"], ["checks", "Steady Check"], ["log", "Log"], ["month", "Month"], ["program", "Program"]];

export function patientView(id, tab = "overview") {
  const r = load(`person:${id}:summary`, () => state.api.personSummary(id), { ttl: 30000 });
  const today = state.api.today();
  const d90 = load(`person:${id}:days90`, () => state.api.personDays(id, addDays(today, -89), today), { ttl: 60000 });
  if (!r.data) return r.status === "error" ? html`<section class="card"><h3>Not available</h3><a class="btn" href="#/panel">Back</a></section>` : html`<div class="card" style="height:300px"></div>`;
  const s = r.data;
  const days = d90.data ?? s.days;
  const p = s.profile ?? {};
  const age = p.birthYear ? new Date().getFullYear() - p.birthYear : null;
  const urgent = (s.alerts ?? []).filter((a) => a.status === "open" && a.severity === "urgent");
  const name = p.displayName ?? "";
  const first = name.split(" ")[0];
  let content;
  if (tab === "overview") content = overview(id, s, days);
  else if (tab === "walking") content = html`${walkingSection(days, s.evaluation, s.events)}${strikeSection(days)}`;
  else if (tab === "balance") content = balanceSection(days, s.evaluation, s.events);
  else if (tab === "activity") content = activityTab(id, s, days);
  else if (tab === "checks") content = checksTab(s, { age, sex: p.sex });
  else if (tab === "log") content = logTab(id, s, first);
  else if (tab === "month") content = monthTab(id, s, first);
  else if (tab === "program") content = programTab(id, s);
  return html`
    <a class="btn ghost small" href="#/panel">${icon("chevronLeft")} Patients</a>
    <div class="clinic-head" style="margin-top:10px">
      ${avatar(name, "lg")}
      <div class="grow"><h1 style="font-size:1.6em">${name}</h1>
        <div class="muted">${[age ? `${age} y` : null, p.sex, ...(p.tags ?? p.settings?.tags ?? [])].filter(Boolean).join(" · ")}</div>
        <div class="small muted">Data ${ago(s.evaluation.coverage.lastSeen)} · ${s.evaluation.coverage.wornDays7}/7 days worn this week</div></div>
      ${urgent.length ? pill("urgent", "Urgent alert") : pill(s.evaluation.status)}
      <button class="btn small" @click=${() => timeSheet(id, first)}>${icon("timer")} Log time</button>
      <button class="btn small" @click=${() => noteSheet(id, first)}>${icon("note")} Note</button>
    </div>
    ${urgent.map((a) => html`<div class="banner" style="background:var(--urgent-soft);color:var(--urgent-ink);margin-bottom:14px">${icon("alert")}<span class="grow"><b>${a.title}</b> · ${fmtDateTime(a.createdAt)}</span>
      <button class="btn small" @click=${() => ack(id, a)}>Acknowledge</button></div>`)}
    <nav class="tabs" aria-label="Patient sections">${TABS.map(([k, l]) => html`<a href=${`#/patient/${id}/${k}`} aria-current=${tab === k ? "page" : "false"}>${l}</a>`)}</nav>
    <div class="stack">${content}</div>
    <div style="margin-top:18px">${nonClinical(s.nonClinical)}</div>
  `;
}

async function ack(id, a) {
  await state.api.ack(id, a.id, null).catch(() => {});
  invalidate(`person:${id}`); invalidate("people"); invalidate("alerts");
  toast("Acknowledged.");
}

function overview(id, s, days) {
  const ev = s.evaluation;
  const recentEvents = (s.events ?? []).slice(0, 5);
  const keys = ["cadence", "strideCv", "sway", "riseTime"];
  return html`
    <div class="grid-2" style="grid-template-columns:minmax(0,1.4fr) minmax(0,1fr)">
      <section class="card stack-sm">
        <div class="card-head" style="margin-bottom:0"><h3>What changed</h3>${pill(ev.status)}</div>
        ${ev.notes.length ? html`<ul class="note-list">${ev.notes.map((n) => html`<li>${pill(n.level === "ok" ? "steady" : n.level, n.level === "ok" ? "Better" : n.level === "review" ? "Changed" : "Watch")}<div><b style="font-weight:650">${n.text}</b><div class="small muted">${n.detail}</div></div></li>`)}</ul>`
          : html`<p class="muted">${ev.status === "learning" ? `Learning this person's usual — ${ev.coverage.learningDaysLeft} more day(s) of wear needed.` : "Everything is within this person's usual range."}</p>`}
      </section>
      <section class="card stack-sm">
        <div class="card-head" style="margin-bottom:0"><h3>Recent log</h3><a class="small" href=${`#/patient/${id}/log`}>All</a></div>
        ${recentEvents.length ? html`<div class="stack-sm">${recentEvents.map(eventRow)}</div>` : html`<p class="muted small">Nothing logged recently.</p>`}
      </section>
    </div>
    <section class="stack-sm"><h2 class="section-title">This week vs usual</h2>${changeMap(ev, { onPick: (k) => (location.hash = `#/patient/${id}/${BY_KEY[k].group === "balance" ? "balance" : BY_KEY[k].group === "activity" ? "activity" : "walking"}`) })}</section>
    <div class="grid-2">${keys.map((k) => trendCard(k, days, ev, s.events, { height: 150 }))}</div>`;
}

function activityTab(id, s, days) {
  const date = state.route.query.date ?? days[days.length - 1]?.date;
  return html`
    <section class="card stack-sm">
      <div class="card-head" style="margin-bottom:0"><h3>Activity & stance time</h3>
        <select class="input" style="width:auto;min-height:36px" aria-label="Day" @change=${(e) => (location.hash = `#/patient/${id}/activity?date=${e.target.value}`)}>
          ${days.slice(-14).reverse().map((d) => html`<option value=${d.date} ?selected=${d.date === date}>${fmtDate(d.date, { weekday: "short", month: "short", day: "numeric" })}</option>`)}
        </select></div>
      ${activityRings(days, date)}
    </section>
    <div class="grid-2">
      ${trendCard("walkMin", days, s.evaluation, s.events, { title: "Walking time", sub: "minutes per day", kind: "bars" })}
      ${trendCard("steps", days, s.evaluation, s.events, { title: "Steps", sub: "per day", kind: "bars" })}
      ${trendCard("unsteady", days, s.evaluation, s.events, { title: "Unsteady moments", sub: "rhythm breaks with a catch step, per day", kind: "bars" })}
    </div>`;
}

function checksTab(s, profile) {
  const checks = s.checks ?? [];
  if (!checks.length) return html`<p class="muted">No Steady Checks yet.</p>`;
  const latest = checks[0];
  const sm = latest.summary?.references ? latest.summary : summarizeCheck(latest.results, profile);
  const series = memo(checks, "scores", () => [...checks].reverse().map((c) => ({ date: c.takenAt.slice(0, 10), value: c.score })));
  const r = (c) => c.results ?? {};
  const tandem = (c) => r(c).balance?.stages?.find((x) => x.stage === "tandem");
  return html`
    <div class="grid-2">
      <section class="card stack-sm">
        <div class="card-head" style="margin-bottom:0"><h3>Latest check</h3><span class="muted small">${fmtDate(latest.takenAt.slice(0, 10), { weekday: "short", month: "short", day: "numeric" })}</span></div>
        <div class="row" style="gap:24px"><div class="stat"><span class="label">Score</span><span class="value">${latest.score}</span></div>
          ${sm.dualTaskCostPct != null ? html`<div class="stat"><span class="label">Dual-task cost</span><span class="value">${sm.dualTaskCostPct}%</span><span class="small muted">slower while counting</span></div>` : nothing}</div>
        <h3 class="small" style="margin-top:6px">Published reference values</h3>
        <div class="list">${sm.references.map((ref) => html`<div class="row"><span class="grow small">${ref.text}<div class="tiny muted">${ref.source}</div></span><b class="small">${ref.value}</b><span class="pill ${ref.met ? "info" : ""}">${ref.met ? "Yes" : "No"}</span></div>`)}</div>
        <p class="footnote">Shown for clinical context only. Steady does not interpret these values.</p>
      </section>
      <section class="card stack-sm"><h3>Score over time</h3><steady-trend .series=${series} unit="" digits="0" label="Steady Check score" height="200"></steady-trend></section>
    </div>
    <div class="table-wrap"><table class="data">
      <thead><tr><th>Date</th><th class="num">Score</th><th class="num">4 m walk</th><th class="num">Talk & walk</th><th>Balance</th><th class="num">Tandem sway</th><th class="num">Chair (30 s)</th><th class="num">TUG</th></tr></thead>
      <tbody>${checks.map((c) => html`<tr>
        <td>${fmtDate(c.takenAt.slice(0, 10), { month: "short", day: "numeric", year: "numeric" })}</td>
        <td class="num"><b>${c.score}</b></td>
        <td class="num">${r(c).walk?.speedMps ?? "—"} m/s</td>
        <td class="num">${r(c).talkWalk?.speedMps ?? "—"} m/s</td>
        <td>${r(c).balance ? `${r(c).balance.completed}/4${r(c).balance.stoppedAt ? ` (stopped: ${STAGES.find((x) => x.key === r(c).balance.stoppedAt)?.key})` : ""}` : "—"}</td>
        <td class="num">${tandem(c)?.swayRmsMm ?? "—"} mm</td>
        <td class="num">${r(c).chair?.count ?? "—"}</td>
        <td class="num">${r(c).tug?.totalS ?? "—"} s</td>
      </tr>`)}</tbody></table></div>`;
}

function logTab(id, s, first) {
  const ev = s.events ?? [];
  const dizzy = ev.filter((e) => e.kind === "dizzy");
  const ctx = dizzy.reduce((a, e) => ((a[e.detail?.context ?? "unsure"] = (a[e.detail?.context ?? "unsure"] ?? 0) + 1), a), {});
  const practice = ev.filter((e) => e.kind === "practice");
  return html`
    <div class="row wrap">
      <button class="btn small" @click=${() => noteSheet(id, first)}>${icon("note")} Add note</button>
      <button class="btn small" @click=${() => noteSheet(id, first, "medChange")}>${icon("pill")} Log medicine change</button>
    </div>
    ${dizzy.length ? html`<section class="card stack-sm"><h3>Dizziness pattern</h3>
      <p class="small muted">${dizzy.length} episode(s) logged. When they started:</p>
      <div class="row wrap">${Object.entries(ctx).map(([k, n]) => html`<span class="pill info">${{ standingUp: "After standing up", turning: "Turning / rolling over", walking: "Walking", still: "At rest", standing: "Standing", sitting: "Sitting", unsure: "Not sure" }[k] ?? k}: ${n}</span>`)}</div>
      ${dizzy.some((e) => e.detail?.autoContext) ? html`<p class="small">Insole context matched ${dizzy.filter((e) => e.detail?.autoContext?.includes("standing up")).length} of ${dizzy.length} to a recent sit-to-stand.</p>` : nothing}
    </section>` : nothing}
    ${practice.length ? html`<section class="card row"><div class="grow"><h3>Exercise practice</h3><div class="small muted">Sessions in the last 14 days</div></div><b style="font-size:1.6em">${practice.filter((e) => e.at.slice(0, 10) > addDays(state.api.today(), -14)).length}</b></section>` : nothing}
    <div class="list">${ev.length ? ev.map(eventRow) : html`<div class="muted">Nothing logged yet.</div>`}</div>`;
}

let timerStart = null;
function monthTab(id, s, first) {
  const month = state.route.query.month ?? state.api.today().slice(0, 7);
  const t = load(`person:${id}:time:${month}`, () => state.api.time(id, month), { ttl: 20000 });
  if (!t.data) return html`<div class="card" style="height:200px"></div>`;
  const daysWith = Array.isArray(t.data.daysWithData) ? t.data.daysWithData : null;
  const nDays = daysWith ? daysWith.length : t.data.daysWithData;
  const shift = (m, k) => { const [y, mo] = m.split("-").map(Number); const d = new Date(y, mo - 1 + k, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
  const monthName = new Date(`${month}-15T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const running = timerStart != null;
  return html`
    <div class="row between wrap">
      <div class="row"><a class="btn small ghost" href=${`#/patient/${id}/month?month=${shift(month, -1)}`} aria-label="Previous month">${icon("chevronLeft")}</a>
        <h2>${monthName}</h2><a class="btn small ghost" href=${`#/patient/${id}/month?month=${shift(month, 1)}`} aria-label="Next month">${icon("chevronRight")}</a></div>
      <button class="btn small" @click=${() => window.print()}>${icon("print")} Print month report</button>
    </div>
    <div class="grid-3">
      <section class="card stack-sm"><h3>Days with data</h3>
        <div class="stat"><span class="value">${nDays}<span class="small muted"> / 16</span></span></div>
        <div class="zbar" style="height:10px"><span class="fill ${nDays >= 16 ? "better" : "same"}" style="left:0;width:${Math.min(100, (nDays / 16) * 100)}%"></span></div>
        ${daysWith ? monthCalendar(month, daysWith) : nothing}</section>
      <section class="card stack-sm"><h3>Interactive time</h3>
        <div class="stat"><span class="value">${t.data.totalMinutes}<span class="small muted"> / 20 min</span></span></div>
        <div class="zbar" style="height:10px"><span class="fill ${t.data.totalMinutes >= 20 ? "better" : "same"}" style="left:0;width:${Math.min(100, (t.data.totalMinutes / 20) * 100)}%"></span></div>
        <button class="btn ${running ? "danger" : "primary"} block" @click=${() => toggleTimer(id, first)}>${icon(running ? "stop" : "play")} ${running ? `Stop timer (${Math.floor((Date.now() - timerStart) / 60000)} min)` : "Start review timer"}</button>
        <button class="btn block" @click=${() => timeSheet(id, first)}>${icon("plus")} Add time manually</button></section>
      <section class="card stack-sm"><h3>This month</h3>
        <dl class="kv small"><dt>Status</dt><dd>${pill(s.evaluation.status)}</dd><dt>Alerts</dt><dd>${(s.alerts ?? []).filter((a) => a.createdAt.startsWith(month)).length}</dd>
          <dt>Checks</dt><dd>${(s.checks ?? []).filter((c) => c.takenAt.startsWith(month)).length}</dd>
          <dt>Practice sessions</dt><dd>${(s.events ?? []).filter((e) => e.kind === "practice" && e.at.startsWith(month)).length}</dd></dl>
        <p class="footnote">Thresholds shown (16 days, 20 minutes) are common remote-monitoring program requirements; confirm against your payer's rules.</p></section>
    </div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>Activity</th><th class="num">Minutes</th><th>Note</th><th>By</th></tr></thead>
      <tbody>${t.data.entries.length ? t.data.entries.map((e) => html`<tr><td>${fmtDateTime(e.at)}</td><td>${{ review: "Data review", call: "Call", message: "Message", visit: "Telehealth visit" }[e.activity] ?? e.activity}</td><td class="num">${e.minutes}</td><td>${e.note ?? ""}</td><td class="small muted">${e.by ?? ""}</td></tr>`) : html`<tr><td colspan="5" class="muted">No time logged this month.</td></tr>`}</tbody></table></div>`;
}

let tick = null;
function toggleTimer(id, first) {
  if (timerStart == null) {
    timerStart = Date.now();
    tick = setInterval(update, 30000);
    update();
    return;
  }
  const minutes = Math.max(1, Math.round((Date.now() - timerStart) / 60000));
  timerStart = null; clearInterval(tick);
  timeSheet(id, first, minutes);
}

function timeSheet(id, first, minutes = 5) {
  let v = { minutes, activity: "review", note: "" };
  openSheet(() => html`<div class="stack">
    <h2>Log time for ${first}</h2>
    <div class="grid-2">
      <div class="field"><label for="tm">Minutes</label><input id="tm" class="input" type="number" min="1" max="120" .value=${String(v.minutes)} @input=${(e) => (v.minutes = Number(e.target.value))} /></div>
      <div class="field"><label for="ta">Activity</label><select id="ta" class="input" @change=${(e) => (v.activity = e.target.value)}>
        ${[["review", "Data review"], ["call", "Call"], ["message", "Message"], ["visit", "Telehealth visit"]].map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select></div>
    </div>
    <div class="field"><label for="tn">Note</label><textarea id="tn" class="input" placeholder="What did you review or discuss?" @input=${(e) => (v.note = e.target.value)}></textarea></div>
    <button class="btn primary block" @click=${async () => {
      if (!(v.minutes >= 1 && v.minutes <= 120)) return toast("Enter 1–120 minutes.");
      await state.api.addTime(id, { minutes: v.minutes, activity: v.activity, note: v.note || null }).catch((e) => toast(e.message));
      closeSheet(); invalidate(`person:${id}:time`); invalidate("people"); toast("Time logged.");
    }}>Save</button>
  </div>`);
}

function programTab(id, s) {
  const prog = { checkEveryDays: 7, exercises: [], riseAndPause: true, ...(s.profile?.program ?? {}) };
  const can = s.link?.scopes?.includes("program") ?? true;
  const save = async (patch) => {
    await state.api.setPlan(id, patch).catch((e) => toast(e.message));
    invalidate(`person:${id}`); toast("Program updated — the wearer sees it on their Move screen.");
  };
  return html`
    ${!can ? html`<div class="banner">${icon("lock")}<span>The wearer hasn't allowed you to change their program.</span></div>` : nothing}
    <section class="card stack">
      <div class="row between wrap"><div><h3>Steady Check</h3><div class="small muted">How often to prompt the wearer</div></div>
        <div class="segmented">${[[7, "Weekly"], [14, "Every 2 weeks"], [30, "Monthly"]].map(([d, l]) => html`<button ?disabled=${!can} aria-pressed=${prog.checkEveryDays === d ? "true" : "false"} @click=${() => save({ checkEveryDays: d })}>${l}</button>`)}</div></div>
      <label class="row between"><span><b>Rise & pause</b><div class="small muted">A gentle insole buzz after standing up, to pause before walking. On after a dizziness log.</div></span>
        <span class="switch"><input type="checkbox" ?disabled=${!can} .checked=${prog.riseAndPause !== false} @change=${(e) => save({ riseAndPause: e.target.checked })} /><span></span></span></label>
    </section>
    <section class="card stack-sm">
      <h3>Home exercises</h3><p class="small muted">Chosen exercises appear first on the wearer's Move screen, with live insole coaching. Completed sessions show in the Log.</p>
      ${EXERCISES.map((e) => html`<label class="row between" style="padding:6px 0">
        <span class="row">${icon(e.icon)}<span><b style="font-weight:650">${e.title}</b><div class="small muted">${e.blurb}</div></span></span>
        <span class="switch"><input type="checkbox" ?disabled=${!can} .checked=${prog.exercises.includes(e.id)} @change=${(ev) => save({ exercises: ev.target.checked ? [...new Set([...prog.exercises, e.id])] : prog.exercises.filter((x) => x !== e.id) })} /><span></span></span>
      </label>`)}
    </section>`;
}

export { eventMarks, metricValue };
