// Measurement sections — the original concept screens (Activity & Stance
// Time, Stride Cadence, Stride Length, Balance & Stability, Strike Position,
// Weight Distribution), rebuilt on everyday data with each person's usual
// drawn in. Shared by the wearer ("My data") and the clinician view.
import { html, nothing } from "../../../vendor/lit.js";
import { memo } from "../../app/state.js";
import { icon } from "../../ui/icons.js";
import { ring, minutesText, fmtDate, pill, deltaVsUsual, zbar, metricValue, metricBig } from "../../ui/components.js";
import { gaitDiagram, feetRegions, weightFeet, swayTarget } from "../../ui/charts.js";
import { BY_KEY, METRICS } from "../../engine/baseline.js";
import { median } from "../../engine/stats.js";

const usual = (days, get) => {
  const v = days.slice(-31, -3).map(get).filter((x) => x != null);
  return v.length >= 5 ? median(v) : null;
};
const recent = (days, get, n = 7) => {
  const v = days.slice(-n).map(get).filter((x) => x != null);
  return v.length ? median(v) : null;
};

export function eventMarks(events = []) {
  const color = { possibleFall: "var(--urgent)", help: "var(--urgent)", dizzy: "var(--watch)", medChange: "var(--info)", note: "var(--line-strong)" };
  const label = { possibleFall: "Possible fall", help: "Asked for help", dizzy: "Felt dizzy", medChange: "Medicine change", note: "Note" };
  return events.filter((e) => color[e.kind]).map((e) => ({ date: (e.date ?? e.at).slice(0, 10), label: `${label[e.kind]}${e.detail?.text ? ` — ${e.detail.text}` : ""}`, color: color[e.kind] }));
}

/** A trend card for one metric, with its usual band. */
export function trendCard(key, days, evaluation, events, { title, sub, height = 170, kind = "line", audience = "clinic" } = {}) {
  const def = BY_KEY[key];
  const m = evaluation?.metrics?.find((x) => x.key === key);
  const series = memo(days, `series:${key}`, () => days.map((d) => ({ date: d.date, value: def.get(d) ?? null })));
  const base = m?.baseline?.median != null ? { median: m.baseline.median, spread: m.baseline.spread } : null;
  const marks = memo(events ?? [], "marks", () => eventMarks(events));
  return html`<section class="card stack-sm">
    <div class="card-head" style="margin-bottom:0">
      <div class="grow"><h3>${title ?? def.label}</h3>${sub ? html`<div class="small muted">${sub}</div>` : nothing}</div>
      ${m && m.level !== "learning" ? levelPill(m) : nothing}
    </div>
    ${m?.recentMedian != null ? html`<div class="row" style="gap:18px;align-items:baseline">
      <div class="stat"><span class="label">This week</span><span class="value">${metricBig(key, m.recentMedian)}</span></div>
      ${base ? html`<div class="stat"><span class="label">Usual</span><span class="value" style="font-size:1.2em;color:var(--ink-2)">${metricBig(key, base.median)}</span></div>` : nothing}
      ${m.changePct != null ? html`<span class="delta ${m.direction}">${m.changePct > 0 ? "+" : ""}${m.changePct.toFixed(0)}%</span>` : nothing}
    </div>` : nothing}
    <steady-trend .series=${series} .baseline=${base} .events=${marks} unit=${def.unit} digits=${def.digits} label=${def.label} height=${height} kind=${kind}></steady-trend>
  </section>`;
}

export function levelPill(m) {
  if (m.level === "review") return pill("review", "Changed");
  if (m.level === "watch") return pill("watch", "A little different");
  if (m.level === "ok" && m.direction === "better") return pill("steady", "Better than usual");
  if (m.level === "ok") return pill("steady", "Like usual");
  return nothing;
}

/** Concept screen 1: Activity & Stance Time — nine rings for one day vs usual. */
export function activityRings(days, date) {
  const d = days.find((x) => x.date === date) ?? days[days.length - 1];
  if (!d?.minutes) return html`<p class="muted">No activity for this day.</p>`;
  const u = (k) => usual(days, (x) => (k === "steps" ? x.steps : x.minutes?.[k]));
  const cell = (label, value, k, fmt) => {
    const uv = u(k);
    return html`<div class="tile" style="padding:10px 6px">
      <div class="label">${label}</div>
      ${ring({ value: value ?? 0, max: Math.max(uv ?? 1, value ?? 0) * 1.05, usual: uv, label: fmt(value), size: 78, color: ringColor(value, uv, k) })}
      ${deltaVsUsual(value, uv, { adverse: k.startsWith("sit") ? "up" : "down", pct: true })}
    </div>`;
  };
  const m = d.minutes;
  const short = (v) => (v == null ? "—" : v >= 60 ? `${(v / 60).toFixed(1)} h` : `${Math.round(v)}m`);
  return html`<div class="tiles" style="grid-template-columns:repeat(3,1fr)">
    ${cell("Steps", d.steps, "steps", (v) => (v ?? 0).toLocaleString())}
    ${cell("Walking", m.walk, "walk", short)}
    ${cell("Brisk / running", m.run, "run", short)}
    ${cell("Standing", m.stand, "stand", short)}
    ${cell("Standing, left leg", m.standLeft, "standLeft", short)}
    ${cell("Standing, right leg", m.standRight, "standRight", short)}
    ${cell("Sitting", m.sit, "sit", short)}
    ${cell("Sitting, left leg up", m.sitLeftRaised, "sitLeftRaised", short)}
    ${cell("Sitting, right leg up", m.sitRightRaised, "sitRightRaised", short)}
  </div>
  <p class="footnote" style="margin-top:6px">${fmtDate(d.date, { weekday: "long", month: "short", day: "numeric" })} · rings fill toward the usual for this person; the tick marks the usual.</p>`;
}
function ringColor(v, u, k) {
  if (v == null || u == null) return "var(--brand)";
  const r = v / u;
  const lowIsBad = !k.startsWith("sit");
  if (lowIsBad ? r < 0.7 : r > 1.3) return "var(--review)";
  if (lowIsBad ? r < 0.88 : r > 1.12) return "var(--watch)";
  return "var(--good)";
}

/** Concept screens 2 & 3: Stride Cadence + Stride Length. */
export function walkingSection(days, evaluation, events, { audience = "clinic" } = {}) {
  const lastG = [...days].reverse().find((d) => d.gait)?.gait;
  const g7 = memo(days, "g7", () => ({
    strideTimeMs: recent(days, (d) => d.gait?.strideTimeMs),
    stancePct: recent(days, (d) => d.gait?.stancePct),
    stepTimeMs: { left: recent(days, (d) => d.gait?.stepTimeMs?.left), right: recent(days, (d) => d.gait?.stepTimeMs?.right) },
  }));
  const plain = audience === "wearer";
  return html`
    <section class="card stack-sm">
      <div class="card-head" style="margin-bottom:0"><h3>${plain ? "Your step rhythm" : "Stride cadence & timing"}</h3></div>
      <p class="small muted">${plain ? "When each foot is on the ground during a typical stride this week." : "Typical stride this week, from walks longer than 5 seconds (steady-state steps only)."}</p>
      ${gaitDiagram({ ...lastG, ...g7, stanceMs: lastG?.stanceMs })}
      <div class="grid-4" style="margin-top:6px">
        ${miniStat("Left step", g7.stepTimeMs.left, "ms")}${miniStat("Right step", g7.stepTimeMs.right, "ms")}
        ${miniStat("Stride", g7.strideTimeMs, "ms")}${miniStat("On ground", g7.stancePct, "% of stride")}
      </div>
    </section>
    <div class="grid-2">
      ${trendCard("cadence", days, evaluation, events, { title: plain ? "Walking pace" : "Cadence", sub: "steps per minute while walking" })}
      ${trendCard("strideCv", days, evaluation, events, { title: plain ? "How even your steps are" : "Stride-time variability", sub: plain ? "lower is more even" : "coefficient of variation; lower = more regular" })}
      ${trendCard("gaitSpeed", days, evaluation, events, { title: "Walking speed (est.)", sub: "from foot motion; best for spotting change" })}
      ${trendCard("strideLength", days, evaluation, events, { title: "Stride length (est.)", sub: "heel strike to the next heel strike of the same foot" })}
      ${trendCard("doubleSupport", days, evaluation, events, { title: plain ? "Time on both feet" : "Double support", sub: plain ? "a more cautious walk keeps both feet down longer" : "% of the gait cycle with both feet loaded" })}
      ${trendCard("stepAsym", days, evaluation, events, { title: plain ? "Favouring one side" : "Step-time asymmetry", sub: "difference between left and right steps" })}
    </div>`;
}

function miniStat(label, v, unit) {
  return html`<div class="stat"><span class="label">${label}</span><span class="value" style="font-size:1.25em">${v == null ? "—" : Math.round(v)}<span class="small muted"> ${unit}</span></span></div>`;
}

/** Concept screen 4: Balance & Stability (+ weight distribution, rising). */
export function balanceSection(days, evaluation, events, { audience = "clinic" } = {}) {
  const plain = audience === "wearer";
  const b = (k) => recent(days, (d) => d.balance?.[k]);
  const ub = (k) => usual(days, (d) => d.balance?.[k]);
  const now = { ml: b("swayMlMm"), ap: b("swayApMm"), rms: b("swayRmsMm") };
  const was = { ml: ub("swayMlMm"), ap: ub("swayApMm"), rms: ub("swayRmsMm") };
  const fr = recent(days, (d) => d.transitions?.failedRises, 7);
  const failed7 = days.slice(-7).reduce((a, d) => a + (d.transitions?.failedRises ?? 0), 0);
  return html`
    <div class="grid-2">
      <section class="card stack-sm">
        <div class="card-head" style="margin-bottom:0"><h3>${plain ? "Standing still" : "Quiet-stance sway"}</h3>${levelPill(evaluation?.metrics?.find((m) => m.key === "sway") ?? {})}</div>
        <p class="small muted">${plain ? "How much you sway when you stand still for 10 seconds or more during the day." : "Centre-of-pressure 95% ellipse from everyday standing (≥10 s, both feet), this week vs usual."}</p>
        ${swayTarget({ usual: was.ml != null ? was : null, now: now.ml != null ? now : null })}
        <dl class="kv small">
          <dt>Sway (RMS)</dt><dd>${fmt1(now.rms)} mm <span class="muted">usual ${fmt1(was.rms)}</span></dd>
          <dt>Side-to-side</dt><dd>${fmt1(now.ml)} mm</dd><dt>Front-to-back</dt><dd>${fmt1(now.ap)} mm</dd>
          ${!plain ? html`<dt>Sway area</dt><dd>${fmt0(b("swayAreaMm2"))} mm² <span class="muted">usual ${fmt0(ub("swayAreaMm2"))}</span></dd><dt>Sway velocity</dt><dd>${fmt1(b("swayVelMmS"))} mm/s</dd>` : nothing}
        </dl>
      </section>
      <section class="card stack-sm">
        <div class="card-head" style="margin-bottom:0"><h3>Weight distribution</h3></div>
        <p class="small muted">${plain ? "Where your weight sits when you stand." : "Standing load share, left/right and toward the forefoot (this week)."}</p>
        ${weightFeet({ leftPct: b("weightLeftPct"), toePct: b("toePct") })}
        <dl class="kv small">
          <dt>Left / right</dt><dd>${fmt0(b("weightLeftPct"))}% / ${b("weightLeftPct") != null ? fmt0(100 - b("weightLeftPct")) : "—"}%</dd>
          <dt>Toward the toes</dt><dd>${fmt0(b("toePct"))}%</dd>
        </dl>
      </section>
    </div>
    <div class="grid-2">
      ${trendCard("sway", days, evaluation, events, { title: plain ? "Sway while standing" : "Sway (RMS)", sub: "lower is steadier" })}
      ${trendCard("riseTime", days, evaluation, events, { title: plain ? "Time to stand up" : "Sit-to-stand time", sub: plain ? "from your chair to standing" : `median per day · failed attempts last 7 days: ${failed7}` })}
    </div>`;
}
const fmt1 = (v) => (v == null ? "—" : v.toFixed(1));
const fmt0 = (v) => (v == null ? "—" : Math.round(v));

/** Concept screen 5: Strike Position / Point of Contact. */
export function strikeSection(days, { audience = "clinic" } = {}) {
  const plain = audience === "wearer";
  const day1 = [...days].reverse().find((d) => d.gait?.strikePct)?.gait;
  const avg = (get) => recent(days, get, 30);
  const s30 = memo(days, "s30", () => ({
    heel: avg((d) => d.gait?.strikePct?.heel), mid: avg((d) => d.gait?.strikePct?.mid), fore: avg((d) => d.gait?.strikePct?.fore), toe: avg((d) => d.gait?.strikePct?.toe),
    toeL: avg((d) => d.gait?.toeUpDeg?.left), toeR: avg((d) => d.gait?.toeUpDeg?.right), rollL: avg((d) => d.gait?.rollDeg?.left), rollR: avg((d) => d.gait?.rollDeg?.right),
  }));
  if (!day1) return html`<section class="card"><p class="muted">No walking measured yet.</p></section>`;
  const rollText = (v) => (v == null ? "—" : `${Math.abs(v).toFixed(1)}° ${v >= 0 ? "supinated" : "pronated"}`);
  return html`<div class="grid-2">
    <section class="card stack-sm">
      <div class="card-head" style="margin-bottom:0"><h3>${plain ? "Where your foot lands" : "Point of contact"}</h3></div>
      <p class="small muted">${plain ? "Which part of your foot touches down first." : "First-loaded region at initial contact, share of steady-state steps (latest day)."}</p>
      ${feetRegions({ left: day1.strikePct, right: day1.strikePct })}
      <div class="legend" style="justify-content:center">
        ${["heel", "mid", "fore", "toe"].map((r) => html`<span><b>${Math.round(day1.strikePct?.[r] ?? 0)}%</b> ${r === "mid" ? "midfoot" : r === "fore" ? "forefoot" : r === "toe" ? "toes" : "heel"} <span class="muted">(30-day ${Math.round(s30[r] ?? 0)}%)</span></span>`)}
      </div>
    </section>
    <section class="card stack-sm">
      <div class="card-head" style="margin-bottom:0"><h3>${plain ? "Foot angle at each step" : "Strike angle"}</h3></div>
      <p class="small muted">${plain ? "How high your toes are as your heel lands — lower toes can catch on rugs and steps." : "Toe-up (dorsiflexion proxy) and roll at initial contact, from the insole's motion sensor."}</p>
      <table class="data"><thead><tr><th></th><th class="num">Latest day</th><th class="num">30-day</th></tr></thead><tbody>
        <tr><td>Left toe-up</td><td class="num">${fmt1(day1.toeUpDeg?.left)}°</td><td class="num">${fmt1(s30.toeL)}°</td></tr>
        <tr><td>Right toe-up</td><td class="num">${fmt1(day1.toeUpDeg?.right)}°</td><td class="num">${fmt1(s30.toeR)}°</td></tr>
        <tr><td>Left roll</td><td class="num">${rollText(day1.rollDeg?.left)}</td><td class="num">${rollText(s30.rollL)}</td></tr>
        <tr><td>Right roll</td><td class="num">${rollText(day1.rollDeg?.right)}</td><td class="num">${rollText(s30.rollR)}</td></tr>
      </tbody></table>
    </section>
  </div>`;
}

/** Change map: every metric, this week vs the person's usual. */
export function changeMap(evaluation, { onPick } = {}) {
  const rows = (evaluation?.metrics ?? []).filter((m) => m.baseline?.median != null);
  if (!rows.length) return html`<p class="muted">Steady needs about a week of wear to learn this person's usual.</p>`;
  return html`<div class="table-wrap"><table class="data">
    <thead><tr><th>Measure</th><th class="num">Usual</th><th class="num">This week</th><th class="num">Change</th><th style="min-width:140px">vs usual spread</th><th>Status</th></tr></thead>
    <tbody>${rows.map((m) => {
      const def = BY_KEY[m.key];
      const z = def.kind === "count" ? null : m.ewma != null ? (def.adverse === "up" ? m.ewma : -m.ewma) : null;
      return html`<tr class=${onPick ? "clickable" : ""} @click=${() => onPick?.(m.key)}>
        <td><b style="font-weight:650">${def.label}</b></td>
        <td class="num">${def.kind === "count" ? `${(m.expected ?? 0).toFixed(1)}/wk` : metricValue(m.key, m.baseline.median)}</td>
        <td class="num">${def.kind === "count" ? `${m.recentTotal ?? 0}` : metricValue(m.key, m.recentMedian)}</td>
        <td class="num"><span class="delta ${m.direction}">${m.changePct != null ? `${m.changePct > 0 ? "+" : ""}${m.changePct.toFixed(0)}%` : "—"}</span></td>
        <td>${def.kind === "count" ? nothing : zbar(z, m.level === "watch" || m.level === "review" ? "worse" : m.direction === "better" ? "better" : "same")}</td>
        <td>${levelPill(m)}</td>
      </tr>`;
    })}</tbody></table></div>`;
}

export { METRICS };
