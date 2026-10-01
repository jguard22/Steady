// Live insoles: pressure under each foot, centre of pressure, what Steady
// thinks you're doing right now.
import { html, nothing, LitElement } from "../../../vendor/lit.js";
import { state } from "../../app/state.js";
import { senseService } from "../../app/sense-service.js";
import { icon } from "../../ui/icons.js";
import { minutesText, fmtNum } from "../../ui/components.js";

const ACT = { walk: "Walking", run: "Moving quickly", stand: "Standing", standLeft: "Standing — more weight on the left", standRight: "Standing — more weight on the right", sit: "Sitting", sitLeftRaised: "Sitting, left leg raised", sitRightRaised: "Sitting, right leg raised", unloaded: "Feet up", notWorn: "Insoles not being worn", noData: "Waiting for data", unknown: "Listening…" };

export function liveView() {
  const live = state.sense.live ?? {};
  const today = senseService.monitor?.today();
  const ins = (state.sense.devices ?? []).filter((d) => d.isInsole);
  return html`
    <div class="row between"><h1>Live</h1>${senseService.demo ? html`<span class="pill brand">${icon("sparkles")} Simulated</span>` : nothing}</div>
    <section class="live-stage"><steady-live></steady-live></section>
    <section class="card row">
      <span class="avatar">${icon(live.activity === "walk" ? "walk" : live.activity?.startsWith("sit") ? "chair" : "foot")}</span>
      <div class="grow"><b>${ACT[live.activity] ?? ACT.unknown}</b>
        <div class="small muted">${live.cadence ? `${live.cadence} steps/min · ` : ""}${live.W ? `weight reference ${live.wSource === "weighIn" ? "from weigh-in" : live.wSource === "walk" ? "learned from walking" : live.wSource === "saved" ? "saved" : "estimated"}` : "learning your weight"}</div></div>
    </section>
    <div class="tiles">
      <div class="tile"><div class="label">Steps ${senseService.demo ? "this session" : "today"}</div><div class="value">${fmtNum(today?.steps ?? 0)}</div></div>
      <div class="tile"><div class="label">Walking</div><div class="value">${minutesText(today?.minutes?.walk ?? 0)}</div></div>
      <div class="tile"><div class="label">Standing</div><div class="value">${minutesText(today?.minutes?.stand ?? 0)}</div></div>
    </div>
    <section class="card stack-sm">
      <h3>Insoles</h3>
      ${ins.length ? ins.map((d) => html`<div class="row"><span class="grow">${d.name}</span>${d.battery != null ? html`<span class="small muted">${icon("battery")} ${d.battery}%</span>` : nothing}</div>`) : html`<p class="muted small">No insoles connected.</p>`}
      <div class="row wrap">
        <button class="btn small" @click=${async () => { const r = await senseService.weighIn(); state.toast = r.ok ? "Weighed in." : "Stand still and try again."; }}>${icon("foot")} Weigh in</button>
        ${state.sense.env === "browser" && navigator.bluetooth ? html`<button class="btn small" @click=${() => senseService.connect({ pick: true })}>${icon("bluetooth")} Add insole</button>` : nothing}
      </div>
      <p class="footnote">Steady shares your insoles with your other BrilliantWear apps. It only asks for the readings it needs, and stops when you close it.</p>
    </section>`;
}

// Foot outline + sensor dots, drawn at display refresh rate.
const FOOT = new Path2D("M50,8 C70,8 82,28 84,55 C86,85 80,110 76,135 C72,160 74,185 72,205 C70,228 60,236 48,236 C34,236 26,226 26,205 C26,185 30,165 28,140 C26,115 18,95 18,65 C18,30 30,8 50,8 Z");

class SteadyLive extends LitElement {
  createRenderRoot() { return this; }
  connectedCallback() {
    super.connectedCallback();
    this.frames = { left: null, right: null };
    this.trail = [];
    this.off = senseService.onFrame((type, f) => {
      if (type !== "pressure") return;
      this.frames[f.side] = f;
      const L = this.frames.left, R = this.frames.right;
      if (L && R) {
        const tot = L.load + R.load;
        if (tot > 0) this.trail.push({ x: R.load / tot, y: ((L.cop?.y ?? 0.5) * L.load + (R.cop?.y ?? 0.5) * R.load) / tot, t: f.t });
        if (this.trail.length > 90) this.trail.shift();
      }
    });
    const loop = () => { this.draw(); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }
  disconnectedCallback() { super.disconnectedCallback(); this.off?.(); cancelAnimationFrame(this.raf); }
  render() { return html`<canvas role="img" aria-label="Live pressure under each foot" style="width:100%;height:340px"></canvas>`; }
  draw() {
    const cv = this.querySelector("canvas");
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const css = getComputedStyle(document.body);
    const col = (v) => css.getPropertyValue(v).trim();
    const scale = Math.min((h - 20) / 244, (w / 2 - 20) / 100);
    const W = senseService.monitor?.W ?? 1000;
    const drawFoot = (side, cx) => {
      const f = this.frames[side];
      ctx.save();
      ctx.translate(cx, 10);
      ctx.scale(side === "left" ? -scale : scale, scale);
      ctx.fillStyle = col("--surface-2"); ctx.strokeStyle = col("--line-strong"); ctx.lineWidth = 1.5 / scale;
      ctx.fill(FOOT); ctx.stroke(FOOT);
      for (const s of f?.sensors ?? []) {
        if (s.x == null) continue;
        const v = Math.max(0, Math.min(1, s.v));
        ctx.beginPath();
        ctx.fillStyle = `rgba(0, 212, 170, ${0.15 + v * 0.85})`;
        ctx.arc(20 + s.x * 60, 230 - s.y * 220, 6 + v * 10, 0, Math.PI * 2);
        ctx.fill();
      }
      if (f?.cop && f.load > W * 0.05) {
        ctx.beginPath(); ctx.fillStyle = col("--ink");
        ctx.arc(20 + f.cop.x * 60, 230 - f.cop.y * 220, 5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
      // load bar
      const share = f ? Math.min(1.2, f.load / W) : 0;
      ctx.fillStyle = col("--surface-3");
      const bx = side === "left" ? cx - 100 * scale - 14 : cx + 100 * scale + 6;
      ctx.fillRect(bx, 20, 8, h - 40);
      ctx.fillStyle = col("--series-1");
      ctx.fillRect(bx, 20 + (h - 40) * (1 - share / 1.2), 8, (h - 40) * (share / 1.2));
    };
    drawFoot("left", w / 2 - 8 - 0 * scale);
    drawFoot("right", w / 2 + 8);
    // combined CoP trail between the feet
    ctx.strokeStyle = col("--series-2"); ctx.lineWidth = 2; ctx.beginPath();
    this.trail.forEach((p, i) => {
      const x = w / 2 + (p.x - 0.5) * 2 * (100 * scale + 8);
      const y = 10 + (230 - p.y * 220) * scale;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
    ctx.stroke();
  }
}
customElements.define("steady-live", SteadyLive);
