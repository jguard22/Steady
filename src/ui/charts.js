// Charts: thin marks, recessive axes, the person's usual drawn as a band.
// Interactive charts are light-DOM custom elements (crosshair + tooltip,
// keyboard-reachable), static ones are plain SVG templates.

import { html, svg, nothing, LitElement, render } from "../../vendor/lit.js";
import { fmtDate } from "./components.js";

const niceTicks = (lo, hi, n = 4) => {
  if (!(hi > lo)) { hi = lo + 1; }
  const span = hi - lo;
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
};
const fmt = (v, d) => (v == null ? "—" : Number(v).toFixed(d));

/**
 * <steady-trend .series=${[{date, value}]} .baseline=${{median, spread}} .events=${[{date,label}]}
 *   unit="steps/min" digits="0" label="Cadence" height="180"></steady-trend>
 */
export class SteadyTrend extends LitElement {
  static properties = {
    series: { attribute: false }, baseline: { attribute: false }, events: { attribute: false },
    unit: {}, digits: { type: Number }, label: {}, height: { type: Number }, color: {}, kind: {},
    hover: { state: true }, width: { state: true },
  };
  constructor() {
    super();
    this.series = []; this.events = []; this.digits = 0; this.height = 180; this.kind = "line"; this.width = 0; this.hover = null;
  }
  createRenderRoot() { return this; }
  connectedCallback() {
    super.connectedCallback();
    this._ro = new ResizeObserver((e) => { const w = Math.round(e[0].contentRect.width); if (w && w !== this.width) this.width = w; });
    this._ro.observe(this);
  }
  disconnectedCallback() { super.disconnectedCallback(); this._ro?.disconnect(); }

  render() {
    const W = this.width || 600, H = this.height, padL = 40, padR = 16, padT = 12, padB = 26;
    const pts = (this.series ?? []).filter((p) => p.value != null);
    if (!pts.length) return html`<div class="muted small" style="height:${H}px;display:grid;place-items:center">Not enough data yet</div>`;
    const dates = this.series.map((p) => p.date);
    const x = (i) => padL + (i / Math.max(1, dates.length - 1)) * (W - padL - padR);
    const vals = pts.map((p) => p.value);
    const b = this.baseline;
    let lo = Math.min(...vals, ...(b?.median != null ? [b.median - b.spread * 1.2] : []));
    let hi = Math.max(...vals, ...(b?.median != null ? [b.median + b.spread * 1.2] : []));
    if (this.kind === "bars") lo = 0;
    const pad = (hi - lo) * 0.08 || 1;
    lo = this.kind === "bars" ? 0 : lo - pad; hi += pad;
    const ticks = niceTicks(lo, hi, 3);
    lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks[ticks.length - 1]);
    const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
    const color = this.color || "var(--series-1)";
    const idx = new Map(dates.map((d, i) => [d, i]));
    // line path with gaps for missing days
    let d = "", pen = false;
    this.series.forEach((p, i) => {
      if (p.value == null) { pen = false; return; }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`;
      pen = true;
    });
    const every = Math.ceil(dates.length / Math.max(2, Math.floor((W - padL - padR) / 70)));
    const xticks = dates.map((dt, i) => ({ dt, i })).filter(({ i }) => (i % every === 0 && dates.length - 1 - i >= every * 0.6) || i === dates.length - 1);
    const step = ticks.length > 1 ? ticks[1] - ticks[0] : 1;
    const tickDigits = Math.max(0, Math.min(3, -Math.floor(Math.log10(step) + 1e-9)));
    const last = this.series.map((p, i) => ({ ...p, i })).filter((p) => p.value != null).pop();
    const hv = this.hover != null ? this.series[this.hover] : null;
    const barW = Math.max(2, Math.min(24, ((W - padL - padR) / dates.length) * 0.6));
    const desc = `${this.label ?? "Trend"}: ${pts.length} days, latest ${fmt(last.value, this.digits)} ${this.unit ?? ""}${b?.median != null ? `, usual ${fmt(b.median, this.digits)}` : ""}`;
    return html`<div class="chart-box">
      <svg class="chart" width=${W} height=${H} viewBox="0 0 ${W} ${H}" role="img" aria-label=${desc} tabindex="0"
        @pointermove=${(e) => this._move(e, x, dates.length, padL, W - padR)} @pointerleave=${() => (this.hover = null)}
        @keydown=${(e) => this._key(e, dates.length)}>
        ${svg`
        ${ticks.map((t) => svg`<line class="gridline" x1=${padL} x2=${W - padR} y1=${y(t)} y2=${y(t)}></line>
          <text x=${padL - 8} y=${y(t) + 4} text-anchor="end">${fmt(t, tickDigits)}</text>`)}
        ${b?.median != null ? svg`
          <rect class="band" x=${padL} width=${W - padL - padR} y=${y(b.median + b.spread)} height=${Math.max(1, y(b.median - b.spread) - y(b.median + b.spread))} rx="4"></rect>
          <line class="median" x1=${padL} x2=${W - padR} y1=${y(b.median)} y2=${y(b.median)}></line>
          <text x=${W - padR} y=${y(b.median + b.spread) - 5} text-anchor="end">usual</text>` : nothing}
        ${xticks.map(({ dt, i }) => svg`<text x=${x(i)} y=${H - 6} text-anchor="middle">${fmtDate(dt)}</text>`)}
        <line class="axis" x1=${padL} x2=${W - padR} y1=${H - padB} y2=${H - padB}></line>
        ${(this.events ?? []).filter((e) => idx.has(e.date)).map((e) => svg`
          <line x1=${x(idx.get(e.date))} x2=${x(idx.get(e.date))} y1=${padT} y2=${H - padB} stroke="var(--line-strong)" stroke-width="1"></line>
          <circle cx=${x(idx.get(e.date))} cy=${H - padB} r="5" fill=${e.color ?? "var(--watch)"} class="dot"><title>${e.label}</title></circle>`)}
        ${this.kind === "bars"
          ? this.series.map((p, i) => p.value == null ? nothing : svg`<path fill=${color} opacity=${this.hover === i ? 1 : 0.85}
              d=${barPath(x(i) - barW / 2, y(p.value), barW, y(lo) - y(p.value))}></path>`)
          : svg`<path class="line" d=${d} stroke=${color}></path>
             <circle class="dot" cx=${x(last.i)} cy=${y(last.value)} r="5" fill=${color}></circle>`}
        ${hv ? svg`<line class="crosshair" x1=${x(this.hover)} x2=${x(this.hover)} y1=${padT} y2=${H - padB}></line>
          ${hv.value != null && this.kind !== "bars" ? svg`<circle class="dot" cx=${x(this.hover)} cy=${y(hv.value)} r="5" fill=${color}></circle>` : nothing}` : nothing}
        `}
      </svg>
      ${hv ? html`<div class="chart-tip" style="left:${Math.min(W - 150, Math.max(0, x(this.hover) + 10))}px;top:4px">
        <b>${hv.value == null ? "No data" : `${fmt(hv.value, this.digits)} ${this.unit ?? ""}`}</b>
        <span class="muted">${fmtDate(hv.date, { weekday: "short", month: "short", day: "numeric" })}</span>
        ${b?.median != null ? html`<div class="muted">usual ${fmt(b.median, this.digits)}</div>` : nothing}
        ${(this.events ?? []).filter((e) => e.date === hv.date).map((e) => html`<div>${e.label}</div>`)}
      </div>` : nothing}
    </div>`;
  }
  _move(e, x, n, x0, x1) {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const i = Math.round(((px - x0) / (x1 - x0)) * (n - 1));
    this.hover = Math.max(0, Math.min(n - 1, i));
  }
  _key(e, n) {
    if (e.key === "ArrowLeft") this.hover = Math.max(0, (this.hover ?? n) - 1);
    else if (e.key === "ArrowRight") this.hover = Math.min(n - 1, (this.hover ?? -1) + 1);
    else if (e.key === "Escape") this.hover = null;
    else return;
    e.preventDefault();
  }
}
customElements.define("steady-trend", SteadyTrend);

function barPath(x, y, w, h) {
  const r = Math.min(4, w / 2, h);
  if (h <= 0) return "";
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** Static sparkline for tables. */
export function sparkline(values, { w = 110, h = 28, color = "var(--series-1)" } = {}) {
  const v = values.map((x) => (x == null || !Number.isFinite(x) ? null : x));
  const ok = v.filter((x) => x != null);
  if (ok.length < 2) return html`<span class="muted small">—</span>`;
  const lo = Math.min(...ok), hi = Math.max(...ok);
  const X = (i) => 2 + (i / (v.length - 1)) * (w - 6);
  const Y = (x) => 3 + (1 - (x - lo) / (hi - lo || 1)) * (h - 6);
  let d = "", pen = false;
  v.forEach((x, i) => { if (x == null) { pen = false; return; } d += `${pen ? "L" : "M"}${X(i).toFixed(1)},${Y(x).toFixed(1)}`; pen = true; });
  const li = v.length - 1 - [...v].reverse().findIndex((x) => x != null);
  return html`<svg width=${w} height=${h} viewBox="0 0 ${w} ${h}" aria-hidden="true">${svg`
    <path d=${d} fill="none" stroke=${color} stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"></path>
    <circle cx=${X(li)} cy=${Y(v[li])} r="3" fill=${color}></circle>`}</svg>`;
}

/** Seven-day strip: bar per day of `get(day)` against the usual. */
export function weekStrip(days, get, { usual, max, labelFor = (d) => fmtDate(d, { weekday: "narrow" }), mark } = {}) {
  const vals = days.map((d) => (d ? get(d) : null));
  const top = max ?? Math.max(1, ...vals.filter((v) => v != null), usual ?? 0) * 1.1;
  return html`<div class="week-strip" role="list">
    ${days.map((d, i) => html`<div class="d" role="listitem" aria-label=${d ? `${fmtDate(d.date, { weekday: "long" })}: ${vals[i] != null ? Math.round(vals[i]) : "no data"}` : "no data"}>
      <div class="bar">
        ${usual ? html`<span style="position:absolute;left:0;right:0;bottom:${(usual / top) * 100}%;border-top:2px dashed var(--line-strong);z-index:1"></span>` : nothing}
        ${vals[i] != null ? html`<i style="height:${Math.max(4, (vals[i] / top) * 100)}%"></i>` : nothing}
      </div>
      ${mark ? html`<span class="mark" style="background:${mark(d) ?? "transparent"}"></span>` : nothing}
      <span>${d ? labelFor(d.date) : ""}</span>
    </div>`)}
  </div>`;
}

/** Month calendar with marked days (e.g. days with data). */
export function monthCalendar(month, markedDates) {
  const [Y, M] = month.split("-").map(Number);
  const first = new Date(Y, M - 1, 1).getDay();
  const n = new Date(Y, M, 0).getDate();
  const set = new Set(markedDates);
  const cells = [];
  for (let i = 0; i < first; i++) cells.push(html`<div class="blank"></div>`);
  for (let d = 1; d <= n; d++) {
    const iso = `${month}-${String(d).padStart(2, "0")}`;
    cells.push(html`<div class=${set.has(iso) ? "on" : ""} title=${iso}>${d}</div>`);
  }
  return html`<div class="cal" role="img" aria-label=${`${set.size} days with data in ${month}`}>
    ${["S", "M", "T", "W", "T", "F", "S"].map((d) => html`<div class="blank tiny">${d}</div>`)}${cells}</div>`;
}

/**
 * Gait timing diagram: stance (bar) and swing (gap) for each foot across two
 * strides — the classic way clinicians read cadence, stance and double support.
 */
export function gaitDiagram(g) {
  if (!g?.strideTimeMs) return html`<p class="muted small">No walking measured yet.</p>`;
  const W = 420, H = 110, x0 = 50, x1 = W - 10;
  const T = g.strideTimeMs;
  const span = 2 * T;
  const X = (ms) => x0 + (ms / span) * (x1 - x0);
  const stanceL = g.stanceMs?.left ?? T * (g.stancePct ?? 62) / 100;
  const stanceR = g.stanceMs?.right ?? T * (g.stancePct ?? 62) / 100;
  const stepL = g.stepTimeMs?.left ?? T / 2;
  const offsetR = T - stepL; // right contact after left
  const rows = [
    { side: "Left", y: 28, color: "var(--series-1)", starts: [0, T], stance: stanceL },
    { side: "Right", y: 72, color: "var(--series-2)", starts: [offsetR - T, offsetR, offsetR + T], stance: stanceR },
  ];
  return html`<svg class="chart" style="max-width:620px" viewBox="0 0 ${W} ${H}" role="img" aria-label=${`Gait timing: stride ${Math.round(T)} ms, stance about ${Math.round((stanceL / T) * 100)}% left and ${Math.round((stanceR / T) * 100)}% right`}>${svg`
    ${rows.map((r) => svg`<text x="0" y=${r.y + 14}>${r.side}</text>
      <rect x=${x0} y=${r.y} width=${x1 - x0} height="22" rx="6" fill="var(--surface-2)"></rect>
      ${r.starts.map((s) => {
        const a = Math.max(0, s), b = Math.min(span, s + r.stance);
        return b > a ? svg`<rect x=${X(a)} y=${r.y} width=${X(b) - X(a)} height="22" rx="6" fill=${r.color}><title>${r.side} foot on the ground ${Math.round(r.stance)} ms</title></rect>` : nothing;
      })}`)}
    <text x=${x0} y=${H - 4}>0</text><text x=${X(T)} y=${H - 4} text-anchor="middle">${Math.round(T)} ms</text><text x=${x1} y=${H - 4} text-anchor="end">${Math.round(span)} ms</text>
  `}</svg>
  <div class="legend"><span><i class="box" style="background:var(--series-1)"></i>Left foot on ground</span><span><i class="box" style="background:var(--series-2)"></i>Right foot on ground</span><span><i class="box" style="background:var(--surface-2)"></i>Swing</span></div>`;
}

// ---------- feet ----------
const FOOT = "M50,8 C70,8 82,28 84,55 C86,85 80,110 76,135 C72,160 74,185 72,205 C70,228 60,236 48,236 C34,236 26,226 26,205 C26,185 30,165 28,140 C26,115 18,95 18,65 C18,30 30,8 50,8 Z";
const REGION_Y = { toe: [8, 58], fore: [58, 112], mid: [112, 170], heel: [170, 236] };

/**
 * Two feet seen from above with regions shaded by share (e.g. point of
 * contact). values: {heel, mid, fore, toe} in %, same for both feet unless
 * left/right given.
 */
export function feetRegions({ left, right, label = "Point of contact" }) {
  const id = Math.random().toString(36).slice(2, 8);
  const foot = (vals, tx, mirror) => svg`<g transform=${`translate(${tx},0)${mirror ? " translate(100,0) scale(-1,1)" : ""}`}>
    <clipPath id=${`c${id}${tx}`}><path d=${FOOT}></path></clipPath>
    <path d=${FOOT} fill="var(--surface-2)" stroke="var(--line-strong)" stroke-width="1.5"></path>
    <g clip-path=${`url(#c${id}${tx})`}>
      ${Object.entries(REGION_Y).map(([r, [a, b]]) => svg`<rect x="0" y=${a} width="100" height=${b - a} fill="var(--series-1)" opacity=${0.08 + Math.min(1, (vals?.[r] ?? 0) / 90) * 0.85}><title>${r}: ${Math.round(vals?.[r] ?? 0)}%</title></rect>`)}
      ${Object.values(REGION_Y).slice(1).map(([a]) => svg`<line x1="0" x2="100" y1=${a} y2=${a} stroke="var(--surface)" stroke-width="2"></line>`)}
    </g></g>`;
  return html`<svg class="chart" viewBox="0 0 230 244" style="max-width:260px;margin:0 auto" role="img" aria-label=${`${label}: heel ${Math.round(left?.heel ?? 0)}%, midfoot ${Math.round(left?.mid ?? 0)}%, forefoot ${Math.round(left?.fore ?? 0)}%, toes ${Math.round(left?.toe ?? 0)}%`}>${svg`
    ${foot(left, 10, true)}${foot(right ?? left, 120, false)}
  `}</svg>`;
}

/** Weight distribution: left/right share and toe/heel share while standing. */
export function weightFeet({ leftPct, toePct }) {
  const l = leftPct ?? 50, r = 100 - l, toe = toePct ?? 40;
  const bar = (x, pct) => svg`<rect x=${x} y=${236 - pct * 2.2} width="8" height=${pct * 2.2} rx="4" fill="var(--series-1)"></rect>`;
  return html`<svg class="chart" viewBox="0 0 250 250" style="max-width:280px;margin:0 auto" role="img" aria-label=${`Standing weight: left ${l.toFixed(0)}%, right ${r.toFixed(0)}%, toward the toes ${toe.toFixed(0)}%`}>${svg`
    <g transform="translate(110,6) scale(-1,1)"><path d=${FOOT} fill="var(--surface-2)" stroke="var(--line-strong)" stroke-width="1.5"></path></g>
    <g transform="translate(140,6)"><path d=${FOOT} fill="var(--surface-2)" stroke="var(--line-strong)" stroke-width="1.5"></path></g>
    ${bar(0, l)}${bar(242, r)}
    <circle cx=${30 + (r / 100) * 190} cy=${236 - toe * 2.2} r="9" fill="var(--brand)" stroke="var(--surface)" stroke-width="3"></circle>
    <text x="4" y="12">${l.toFixed(0)}%</text><text x="246" y="12" text-anchor="end">${r.toFixed(0)}%</text>
  `}</svg>`;
}

/**
 * CoP sway picture: the 95% ellipse for the usual and for this week, drawn
 * from ML/AP RMS (a schematic of the measurement, not a trace).
 */
export function swayTarget({ usual, now }) {
  const S = 220, c = S / 2;
  const big = Math.max(usual?.ml ?? 0, usual?.ap ?? 0, now?.ml ?? 0, now?.ap ?? 0) * 2.45;
  const scale = big > 0 ? Math.min(9, 78 / big) : 7; // px per mm, largest ellipse ≈ 78 px
  const ell = (m, cls, color) => m ? svg`<ellipse cx=${c} cy=${c} rx=${Math.min(c - 8, m.ml * 2.45 * scale)} ry=${Math.min(c - 8, m.ap * 2.45 * scale)} fill=${color} fill-opacity="0.12" stroke=${color} stroke-width="2" class=${cls}></ellipse>` : nothing;
  return html`<svg class="chart" viewBox="0 0 ${S} ${S}" style="max-width:240px;margin:0 auto" role="img" aria-label=${`Standing sway: this week ${now?.rms?.toFixed(1) ?? "—"} mm, usual ${usual?.rms?.toFixed(1) ?? "—"} mm`}>${svg`
    <g opacity="0.5"><g transform=${`translate(${c - 64},${c - 62}) scale(0.5)`}><g transform="translate(100,0) scale(-1,1)"><path d=${FOOT} fill="var(--surface-2)" stroke="var(--line-strong)"></path></g></g>
      <g transform=${`translate(${c + 14},${c - 62}) scale(0.5)`}><path d=${FOOT} fill="var(--surface-2)" stroke="var(--line-strong)"></path></g></g>
    ${[30, 60, 90].map((r) => svg`<circle cx=${c} cy=${c} r=${r} fill="none" stroke="var(--grid)"></circle>`)}
    <line x1=${c} x2=${c} y1="6" y2=${S - 6} stroke="var(--grid)"></line><line y1=${c} y2=${c} x1="6" x2=${S - 6} stroke="var(--grid)"></line>
    <text x=${c} y="16" text-anchor="middle">Front</text><text x=${c} y=${S - 6} text-anchor="middle">Back</text>
    <text x="4" y=${c - 6}>Left</text><text x=${S - 4} y=${c - 6} text-anchor="end">Right</text>
    ${ell(usual, "", "var(--series-1)")}
    ${ell(now, "", "var(--series-2)")}
    <circle cx=${c} cy=${c} r="4" fill="var(--ink)"></circle>
  `}</svg>
  <div class="legend" style="justify-content:center"><span><i style="background:var(--series-1)"></i>Usual</span><span><i style="background:var(--series-2)"></i>This week</span></div>`;
}

export { render };
