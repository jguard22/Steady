// Small presentational building blocks (lit-html templates).
import { html, nothing, svg } from "../../vendor/lit.js";
import { icon, STATUS_ICON } from "./icons.js";
import { STATUS_TEXT, BY_KEY } from "../engine/baseline.js";

export const LEVEL_CLASS = { steady: "good", ok: "good", watch: "watch", review: "review", urgent: "urgent", learning: "info", nodata: "info", info: "info" };
export const LEVEL_TEXT = { steady: "Steady", ok: "Like usual", watch: "A little different", review: "Worth a check-in", urgent: "Urgent", learning: "Learning", nodata: "No recent data", info: "Info" };

export function pill(level, text = LEVEL_TEXT[level] ?? level) {
  const cls = LEVEL_CLASS[level] ?? "";
  return html`<span class="pill ${cls}">${icon(STATUS_ICON[level] ?? "info")}${text}</span>`;
}

const NOTE_GROUP = { walkMin: "activity", steps: "activity", sway: "balance", riseTime: "balance" };
export function statusHero(ev, { name, audience = "wearer", onWhy, scopes } = {}) {
  const st = ev?.status ?? "learning";
  const cls = LEVEL_CLASS[st];
  const text = STATUS_TEXT[st];
  const who = audience === "wearer" ? text.wearer : watcherLine(st, name, ev);
  return html`<section class="hero ${st === "steady" ? "good" : st}" aria-live="polite">
    <div class="halo"></div>
    <div class="row" style="align-items:flex-start;position:relative">
      <div class="status-mark">${icon(STATUS_ICON[st] ?? "info")}</div>
      <div class="grow stack-sm">
        <span class="small muted" style="font-weight:650">${audience === "wearer" ? "This week" : name}</span>
        <h2>${text.title}</h2>
        <p class="ink-2">${who}</p>
        ${st === "learning" && ev?.coverage ? html`<p class="small muted">${ev.coverage.learningDaysLeft} more day${ev.coverage.learningDaysLeft === 1 ? "" : "s"} of wear to learn the usual.</p>` : nothing}
      </div>
    </div>
    ${ev?.notes?.length ? html`<ul class="note-list" style="margin-top:16px;position:relative">
      ${ev.notes.slice(0, audience === "wearer" ? 3 : 4).map((n) => html`<li>
        <span class="pill ${LEVEL_CLASS[n.level] ?? "good"}" style="padding:4px">${icon(n.level === "ok" ? "check" : n.level === "review" ? "alert" : "eye")}</span>
        <div><b style="font-weight:650">${n.text}</b>${n.detail && (!scopes || scopes.includes(NOTE_GROUP[n.key] ?? "gait")) ? html`<div class="small muted">${n.detail}</div>` : nothing}</div>
      </li>`)}
    </ul>` : nothing}
    ${onWhy ? html`<button class="btn ghost small" style="margin-top:8px;position:relative" @click=${onWhy}>${icon("info")} How Steady decides</button>` : nothing}
  </section>`;
}

function watcherLine(st, name, ev) {
  const first = (name ?? "").split(" ")[0] || "They";
  if (st === "steady") return `${first} is moving like their usual self this week.`;
  if (st === "watch") return `A few things look a little different from ${first}'s usual this week.`;
  if (st === "review") return `Several things look different from ${first}'s usual. A check-in may help.`;
  if (st === "nodata") return `Steady hasn't heard from ${first}'s insoles${ev?.coverage?.lastSeen ? ` since ${fmtDate(ev.coverage.lastSeen)}` : ""}.`;
  return `Steady is still learning ${first}'s usual.`;
}

/** Progress ring. value/max fill; `usual` draws a tick at the usual level. */
export function ring({ value, max, label, sub, usual, color = "var(--brand)", size = 92 }) {
  const r = 40, c = 2 * Math.PI * r;
  const frac = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const tick = usual != null && max > 0 ? Math.min(1, usual / max) : null;
  return html`<div class="ring-wrap" style="width:${size}px;height:${size}px">
    <svg viewBox="0 0 100 100" aria-hidden="true">${svg`
      <circle cx="50" cy="50" r=${r} fill="none" class="ring-track" stroke-width="10"></circle>
      <circle cx="50" cy="50" r=${r} fill="none" class="ring-fill" stroke=${color} stroke-width="10" stroke-linecap="round" stroke-dasharray=${c} stroke-dashoffset=${c * (1 - frac)}></circle>
      ${tick != null ? svg`<line x1="96" y1="50" x2="84" y2="50" stroke="var(--ink-2)" stroke-width="3" stroke-linecap="round" transform=${`rotate(${tick * 360} 50 50)`}></line>` : nothing}`}
    </svg>
    <div class="ring-label"><div><b>${label}</b>${sub ? html`<small>${sub}</small>` : nothing}</div></div>
  </div>`;
}

export function deltaVsUsual(cur, usual, { adverse = "down", unit = "", digits = 0, pct = false } = {}) {
  if (cur == null || usual == null || !usual) return html`<span class="delta same">—</span>`;
  const d = cur - usual;
  const rel = (d / usual) * 100;
  const worse = adverse === "down" ? d < 0 : d > 0;
  const same = Math.abs(rel) < 5;
  const cls = same ? "same" : worse ? "worse" : "better";
  const txt = pct || unit === "%" ? `${d > 0 ? "+" : ""}${rel.toFixed(0)}%` : `${d > 0 ? "+" : ""}${d.toFixed(digits)}${unit ? " " + unit : ""}`;
  return html`<span class="delta ${cls}">${same ? "about usual" : `${txt} vs usual`}</span>`;
}

export function action({ ic, title, sub, href, onClick, tone }) {
  const inner = html`<span class="badge-icon" style=${tone ? `background:var(--${tone}-soft);color:var(--${tone}-ink)` : ""}>${icon(ic)}</span>
    <span class="grow"><b>${title}</b>${sub ? html`<span class="sub">${sub}</span>` : nothing}</span>
    <span class="chev">${icon("chevronRight")}</span>`;
  return href ? html`<a class="action" href=${href}>${inner}</a>` : html`<button class="action" @click=${onClick}>${inner}</button>`;
}

export function zbar(z, direction) {
  if (z == null) return html`<div class="zbar" aria-hidden="true"><span class="mid"></span></div>`;
  const v = Math.max(-4, Math.min(4, z));
  const w = (Math.abs(v) / 4) * 50;
  const left = v >= 0 ? 50 : 50 - w;
  return html`<div class="zbar" role="img" aria-label=${`${z.toFixed(1)} spreads ${direction === "worse" ? "toward worse" : direction === "better" ? "toward better" : ""}`}>
    <span class="mid"></span><span class="fill ${direction}" style="left:${left}%;width:${w}%"></span></div>`;
}

export function initials(name = "") {
  return name.replace(/^Dr\.?\s+/, "").split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]).join("").toUpperCase();
}

export function avatar(name, cls = "") {
  return html`<span class="avatar ${cls}" aria-hidden="true">${initials(name)}</span>`;
}

export function empty(ic, title, body, cta = nothing) {
  return html`<div class="card flat center stack" style="padding:32px 20px">
    <div style="margin:0 auto" class="avatar lg">${icon(ic)}</div>
    <h3>${title}</h3><p class="muted">${body}</p>${cta}</div>`;
}

export function metricValue(key, v) {
  const def = BY_KEY[key];
  if (v == null) return "—";
  const n = Number(v).toFixed(def?.digits ?? 1);
  return def?.unit && def.unit !== "%" ? `${n} ${def.unit}` : `${n}${def?.unit ?? ""}`;
}

/** Big number with a quieter unit, for stat blocks. */
export function metricBig(key, v) {
  const def = BY_KEY[key];
  if (v == null) return "—";
  const n = Number(v).toFixed(def?.digits ?? 1);
  return html`${n}<span class="unit">${def?.unit === "%" ? "%" : def?.unit ? ` ${def.unit}` : ""}</span>`;
}

export function fmtDate(iso, opts = { month: "short", day: "numeric" }) {
  if (!iso) return "";
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00`) : new Date(iso);
  return d.toLocaleDateString(undefined, opts);
}
export function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
export function fmtDateTime(iso) {
  return `${fmtDate(iso, { weekday: "short", month: "short", day: "numeric" })} · ${fmtTime(iso)}`;
}
export function ago(iso) {
  if (!iso) return "never";
  if (iso.length === 10) {
    const now = new Date();
    const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const days = Math.round((Date.parse(today) - Date.parse(iso)) / 86400000);
    return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
  }
  const t = iso.length === 10 ? new Date(`${iso}T20:00:00`).getTime() : new Date(iso).getTime();
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 2) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
export function minutesText(min) {
  if (min == null) return "—";
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}
export function fmtNum(n) {
  return n == null ? "—" : Math.round(n).toLocaleString();
}

export function nonClinical(text) {
  return html`<p class="footnote">${icon("shield", "")} ${text}</p>`;
}

export function demoBanner(who, onExit) {
  return html`<div class="banner demo" role="note">${icon("sparkles")}<span class="grow">Demo — ${who}. Everything here is made-up sample data.</span>
    <button class="btn small ghost" @click=${onExit}>Exit</button></div>`;
}
