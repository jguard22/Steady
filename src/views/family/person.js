import { html, nothing } from "../../../vendor/lit.js";
import { state, load, memo, invalidate, toast, openSheet, closeSheet, go } from "../../app/state.js";
import { icon } from "../../ui/icons.js";
import { statusHero, avatar, ago, pill, fmtDateTime, fmtDate, nonClinical, minutesText } from "../../ui/components.js";
import { weekStrip, sparkline } from "../../ui/charts.js";
import { addDays } from "../../engine/baseline.js";
import { median } from "../../engine/stats.js";

export function personSummaryLoad(id) {
  return load(`person:${id}:summary`, () => state.api.personSummary(id), { ttl: 30000 });
}

export function personView(id) {
  const r = personSummaryLoad(id);
  if (!r.data) return r.status === "error" ? html`<section class="card"><h3>Not available</h3><p class="muted">You may no longer be in this circle.</p><a class="btn" href="#/people">Back</a></section>` : html`<div class="card" style="height:240px"></div>`;
  const s = r.data;
  const name = s.profile?.displayName ?? "";
  const first = name.split(" ")[0];
  const today = state.api.today();
  const urgent = (s.alerts ?? []).filter((a) => a.status === "open" && a.severity === "urgent");
  const others = (s.alerts ?? []).filter((a) => !(a.status === "open" && a.severity === "urgent")).slice(0, 5);
  const week = memo(s, "week", () => Array.from({ length: 7 }, (_, i) => s.days.find((d) => d.date === addDays(today, i - 6)) ?? null));
  const usualWalk = memo(s, "uw", () => { const v = s.days.slice(-31, -3).map((d) => d.minutes?.walk).filter((x) => x != null); return v.length >= 5 ? median(v) : null; });
  const dayMark = (d) => {
    if (!d) return "var(--line-strong)";
    if ((d.events?.possibleFalls ?? 0) > 0) return "var(--urgent)";
    return null;
  };
  const latest = s.checks?.[0], prev = s.checks?.[1];
  const todayDay = s.days.find((d) => d.date === today);
  return html`
    <a class="btn ghost small" href="#/people?list=1" style="justify-self:start">${icon("chevronLeft")} People</a>
    <section class="row">
      ${avatar(name, "lg")}
      <div class="grow"><h1 style="font-size:1.5em">${name}</h1><div class="small muted">Insoles last used ${ago(s.evaluation.coverage.lastSeen)}</div></div>
    </section>

    ${urgent.map((a) => html`<section class="hero urgent stack-sm" role="alert">
      <div class="row"><span class="pill urgent">${icon("alert")} Urgent</span><span class="small muted">${fmtDateTime(a.createdAt)}</span></div>
      <h2>${a.title}</h2>
      <p class="ink-2">${a.kind === "possibleFall" ? `${first}'s insoles noticed what may have been a fall and ${first} didn't answer “Are you OK?”.` : `${first} asked for help from Steady.`} Please check on ${first} now.</p>
      <div class="row wrap">
        <button class="btn primary" @click=${() => ackSheet(id, a, first)}>${icon("check")} I've checked on ${first}</button>
        <a class="btn danger" href="tel:911">${icon("phone")} Call 911</a>
      </div>
    </section>`)}

    ${statusHero(s.evaluation, { audience: "watcher", name, scopes: s.scopes ?? s.link?.scopes })}

    ${s.scopes?.includes("activity") !== false ? html`<section class="card stack-sm">
      <div class="card-head"><h3>Walking this week</h3>${todayDay ? html`<span class="small muted">Today: ${minutesText(todayDay.minutes?.walk)}</span>` : nothing}</div>
      ${weekStrip(week, (d) => d.minutes?.walk, { usual: usualWalk, mark: dayMark })}
      <p class="footnote">Dashed line: ${first}'s usual. A red dot marks a day with a possible fall.</p>
    </section>` : nothing}

    ${latest ? html`<section class="card row">
      <div class="grow"><h3>Steady Check</h3><div class="small muted">${fmtDate(latest.takenAt.slice(0, 10), { weekday: "short", month: "short", day: "numeric" })}${prev ? ` · ${latest.score - prev.score >= 0 ? "+" : ""}${latest.score - prev.score} since the one before` : ""}</div></div>
      ${sparkline([...s.checks].reverse().map((c) => c.score), { w: 90 })}
      <div class="stat" style="text-align:right"><span class="value">${latest.score}</span><span class="label">of 100</span></div>
    </section>` : nothing}

    ${others.length ? html`<section class="stack-sm"><h2 class="section-title">Recent alerts</h2>
      <div class="list">${others.map((a) => html`<div class="row">
        ${pill(a.status === "resolved" || a.status === "acked" ? "steady" : a.severity === "info" ? "info" : a.severity, a.status === "acked" ? "Seen" : a.status === "resolved" ? "Resolved" : a.severity === "info" ? "Info" : "New")}
        <div class="grow"><b style="font-weight:650">${a.title}</b><div class="small muted">${fmtDateTime(a.createdAt)}${a.ackBy ? ` · seen by ${a.ackBy}` : ""}</div></div>
        ${a.status === "open" && !a.computed ? html`<button class="btn small" @click=${() => ackSheet(id, a, first)}>Mark seen</button>` : nothing}
      </div>`)}</div></section>` : nothing}

    ${(s.events ?? []).filter((e) => ["dizzy", "medChange", "note"].includes(e.kind)).length ? html`<section class="stack-sm"><h2 class="section-title">Notes & log</h2>
      <div class="list">${s.events.filter((e) => ["dizzy", "medChange", "note"].includes(e.kind)).slice(0, 6).map(eventRow)}</div></section>` : nothing}

    <section class="grid-2" style="grid-template-columns:1fr 1fr">
      <button class="btn block" @click=${() => noteSheet(id, first)}>${icon("message")} Add a note</button>
      <button class="btn block" @click=${() => noteSheet(id, first, "medChange")}>${icon("pill")} Medicine change</button>
    </section>
    <button class="btn ghost small" style="justify-self:center" @click=${() => leaveSheet(id, first)}>Leave ${first}'s circle</button>
    ${nonClinical(s.nonClinical)}
  `;
}

export function eventRow(e) {
  const map = { dizzy: ["dizzy", "Felt dizzy"], medChange: ["pill", "Medicine change"], note: ["note", "Note"], possibleFall: ["alert", "Possible fall"], help: ["bell", "Asked for help"], practice: ["balance", "Balance practice"], sensation: ["vibrate", "Foot sensation check"] };
  const EX = { weightShift: "Reach for the targets", steadyStance: "Steady stance", heelRaise: "Heel raises", toeRaise: "Toe raises", sitToStand: "Sit to stand", marching: "March in place", rhythmWalk: "Rhythm walk" };
  const [ic, label] = map[e.kind] ?? ["info", e.kind];
  const ctx = { standingUp: "just after standing up", turning: "when turning or rolling over", walking: "while walking", still: "while still", standing: "while standing", sitting: "while sitting" }[e.detail?.context];
  return html`<div class="row" style="align-items:flex-start">
    <span class="avatar" style="width:36px;height:36px">${icon(ic)}</span>
    <div class="grow"><b style="font-weight:650">${label}${ctx ? ` — ${ctx}` : ""}</b>
      ${e.detail?.text ? html`<div class="small ink-2">${e.detail.text}</div>` : nothing}
      ${e.kind === "practice" ? html`<div class="small ink-2">${EX[e.detail?.exercise] ?? e.detail?.exercise}${e.detail?.reps ? ` · ${e.detail.reps} done` : ""}${e.detail?.durationS ? ` · ${Math.round(e.detail.durationS / 60)} min` : ""}</div>` : nothing}
      ${e.kind === "sensation" ? html`<div class="small ink-2">Felt left ${e.detail?.left ?? "—"}, right ${e.detail?.right ?? "—"}</div>` : nothing}
      ${e.detail?.autoContext ? html`<div class="small muted">Insoles: ${e.detail.autoContext.toLowerCase()}</div>` : nothing}
      <div class="small muted">${fmtDateTime(e.at)}${e.detail?.by ? ` · ${e.detail.by}` : ""}</div></div>
  </div>`;
}

function ackSheet(id, alert, first) {
  let note = "";
  openSheet(() => html`<div class="stack">
    <h2>Mark as seen</h2>
    <p class="ink-2">${alert.title}. Others in ${first}'s circle will see that you've handled it.</p>
    <div class="field"><label for="ack-note">What happened? (optional)</label>
      <textarea id="ack-note" class="input" placeholder="e.g. Called her — she's fine, sat down too fast." @input=${(e) => (note = e.target.value)}></textarea></div>
    <button class="btn primary block" @click=${async () => {
      await state.api.ack(id, alert.id, note || null).catch(() => {});
      closeSheet(); invalidate(`person:${id}`); invalidate("people"); toast("Marked as seen.");
    }}>Done</button>
  </div>`);
}

export function noteSheet(id, first, kind = "note") {
  let text = "";
  openSheet(() => html`<div class="stack">
    <h2>${kind === "medChange" ? "Log a medicine change" : `Add a note for ${first}'s circle`}</h2>
    <p class="ink-2">${kind === "medChange" ? "New medicines, dose changes and stopped medicines can affect balance. Steady marks the date on every chart." : "Notes are shared with everyone in the circle who can see the log."}</p>
    <textarea class="input" placeholder=${kind === "medChange" ? "e.g. Started a new blood-pressure medicine, morning dose" : "Write a note"} @input=${(e) => (text = e.target.value)}></textarea>
    <button class="btn primary block" @click=${async () => {
      if (!text.trim()) return;
      await state.api.addNote(id, { text: text.trim(), kind }).catch(() => {});
      closeSheet(); invalidate(`person:${id}`); toast("Saved.");
    }}>Save</button>
  </div>`);
}

function leaveSheet(id, first) {
  openSheet(() => html`<div class="stack">
    <h2>Leave ${first}'s circle?</h2>
    <p class="ink-2">You'll stop seeing ${first}'s updates and alerts. ${first} can invite you again later.</p>
    <button class="btn danger block" @click=${async () => { await state.api.leave(id).catch(() => {}); closeSheet(); invalidate(""); go("#/people"); }}>Leave circle</button>
    <button class="btn ghost block" @click=${closeSheet}>Cancel</button>
  </div>`);
}
