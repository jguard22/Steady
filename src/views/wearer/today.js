import { html, nothing } from "../../../vendor/lit.js";
import { state, load, memo, openSheet, closeSheet, toast, invalidate, set } from "../../app/state.js";
import { senseService } from "../../app/sense-service.js";
import { icon } from "../../ui/icons.js";
import { statusHero, ring, action, minutesText, fmtNum, fmtDate, nonClinical, ago } from "../../ui/components.js";
import { weekStrip } from "../../ui/charts.js";
import { addDays } from "../../engine/baseline.js";
import { median } from "../../engine/stats.js";

export function mySummary() {
  const s = load("me:summary", () => state.api.summary(), { ttl: 30000 });
  if (s.data) {
    state.profileCache = s.data.profile;
    state.recentEvents = s.data.events;
    state.topAlerts = (s.data.alerts ?? []).filter((a) => a.status === "open").length;
  }
  return s;
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function usualOf(days, get) {
  const vals = days.slice(-31, -3).map(get).filter((v) => v != null);
  return vals.length >= 5 ? median(vals) : null;
}

export function todayView() {
  const s = mySummary();
  if (!s.data) return s.status === "error" ? errorCard(s.error) : html`<div class="card" style="height:220px"></div>`;
  const { evaluation, days, profile, checks } = s.data;
  const first = (profile.displayName || "").split(" ")[0];
  const todayIso = state.api.today();
  const live = state.sense.live;
  const stored = days.find((d) => d.date === todayIso);
  // the monitor's running numbers win for today (live + newer than the last sync)
  const today = (state.mode !== "demo" && senseService.monitor?.today()) || stored;
  const usualWalk = usualOf(days, (d) => d.minutes?.walk);
  const usualSteps = usualOf(days, (d) => d.steps);
  const usualFeet = usualOf(days, (d) => (d.minutes ? d.minutes.walk + d.minutes.stand : null));
  const week = memo(s.data, "week", () => Array.from({ length: 7 }, (_, i) => days.find((d) => d.date === addDays(todayIso, i - 6)) ?? null));
  const lastCheck = checks?.[0];
  const every = profile.program?.checkEveryDays ?? 7;
  const due = lastCheck ? addDays(lastCheck.takenAt.slice(0, 10), every) : todayIso;
  const dueText = due <= todayIso ? "Due today — about 6 minutes" : `Next one ${fmtDate(due, { weekday: "long" })}`;
  const onFeet = today?.minutes ? today.minutes.walk + today.minutes.stand : null;

  return html`
    <section class="stack-sm" style="margin-top:4px">
      <h1>${greeting()}${first ? `, ${first}` : ""}</h1>
      <p class="muted">${new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>
    </section>

    ${statusHero(evaluation, { audience: "wearer", onWhy: () => openSheet(whySheet) })}

    <section class="stack-sm" aria-label="Today so far">
      <h2 class="section-title">Today so far</h2>
      <div class="tiles">
        <div class="tile">${ring({ value: today?.minutes?.walk ?? 0, max: Math.max((usualWalk ?? 30) * 1.25, today?.minutes?.walk ?? 0), usual: usualWalk, label: `${Math.round(today?.minutes?.walk ?? 0)}`, sub: "min walking" })}
          <div class="delta">${usualWalk ? `usual ${Math.round(usualWalk)} min/day` : "learning"}</div></div>
        <div class="tile">${ring({ value: today?.steps ?? 0, max: Math.max((usualSteps ?? 3000) * 1.25, today?.steps ?? 0), usual: usualSteps, label: fmtNum(today?.steps ?? 0), sub: "steps", color: "var(--series-1)" })}
          <div class="delta">${usualSteps ? `usual ${fmtNum(usualSteps)}` : "learning"}</div></div>
        <div class="tile">${ring({ value: onFeet ?? 0, max: Math.max((usualFeet ?? 120) * 1.25, onFeet ?? 0), usual: usualFeet, label: hoursText(onFeet ?? 0), sub: "on feet", color: "var(--series-3)" })}
          <div class="delta">${usualFeet ? `usual ${minutesText(usualFeet)}` : "learning"}</div></div>
      </div>
    </section>

    <section class="stack-sm">
      ${action({ ic: "checkCircle", title: "Steady Check", sub: lastCheck ? `${dueText} · last score ${lastCheck.score}` : "Your first check takes about 6 minutes", href: "#/check" })}
      ${action({ ic: "balance", title: "Balance practice", sub: practiceLine(profile), href: "#/move" })}
    </section>

    ${insolesCard(live)}

    <section class="card stack-sm">
      <div class="card-head"><h3>Your week of walking</h3><a class="small" href="#/data/activity">Details</a></div>
      ${weekStrip(week, (d) => d.minutes?.walk, { usual: usualWalk })}
    </section>

    <section class="grid-2" style="grid-template-columns:1fr 1fr">
      <button class="action" style="min-height:76px" @click=${() => set({ overlay: { kind: "dizzy" } })}>
        <span class="badge-icon" style="background:var(--watch-soft);color:var(--watch-ink)">${icon("dizzy")}</span><span class="grow"><b>I feel dizzy</b></span></button>
      <button class="action" style="min-height:76px" @click=${() => openSheet(helpSheet)}>
        <span class="badge-icon" style="background:var(--urgent-soft);color:var(--urgent-ink)">${icon("phone")}</span><span class="grow"><b>I need help</b></span></button>
    </section>

    ${nonClinical(s.data.nonClinical ?? state.api.nonClinical)}
  `;
}

function hoursText(min) {
  return min >= 60 ? `${(min / 60).toFixed(1)} h` : `${Math.round(min)} m`;
}

function practiceLine(profile) {
  const n = (profile.program?.exercises ?? []).length;
  return n ? `${n} exercises chosen for you · about 10 minutes` : "Gentle exercises with live feedback";
}

function insolesCard(live) {
  const sense = state.sense;
  const ins = (sense.devices ?? []).filter((d) => d.isInsole);
  const status = sense.status;
  if (status === "live" || ins.length) {
    const act = { walk: "Walking", run: "Moving quickly", stand: "Standing", standLeft: "Standing, more on your left", standRight: "Standing, more on your right", sit: "Sitting", sitLeftRaised: "Sitting, left leg up", sitRightRaised: "Sitting, right leg up", unloaded: "Feet up", notWorn: "Not being worn", noData: "Waiting for data" }[live?.activity] ?? "Listening";
    return html`<a class="card card-link row" href="#/live" aria-label="Insoles connected. Open live view">
      <span class="avatar" style="background:var(--good-soft);color:var(--good-ink)">${icon("foot")}</span>
      <span class="grow"><b>Insoles connected</b><div class="small muted">${act}${live?.cadence ? ` · ${live.cadence} steps/min` : ""}</div></span>
      <span class="small muted row" style="gap:6px">${ins.map((d) => html`<span title=${d.name}>${d.side === "left" ? "L" : d.side === "right" ? "R" : ""} ${d.battery != null ? `${d.battery}%` : ""}</span>`)}</span>
      ${icon("chevronRight")}
    </a>`;
  }
  const inFrame = (() => { try { return window.parent !== window; } catch { return true; } })();
  return html`<section class="card row">
    <span class="avatar">${icon("bluetooth")}</span>
    <span class="grow"><b>${status === "loading" ? "Looking for your insoles…" : status === "permission" ? "Steady needs permission" : "Insoles not connected"}</b>
      <div class="small muted">${status === "permission" ? "Allow Steady to read your insoles in the BrilliantWear app." : inFrame ? "Connect them in the BrilliantWear app's Devices tab." : "Steady measures while your insoles are connected."}</div></span>
    ${!inFrame && navigator.bluetooth ? html`<button class="btn small primary" @click=${() => senseService.connect({ pick: true })}>Connect</button>` : nothing}
  </section>`;
}

function whySheet() {
  return html`<div class="stack">
    <h2>How Steady decides</h2>
    <p class="ink-2">Steady compares this week with your own usual — the four weeks before it. Everyone walks differently, so it never compares you with other people.</p>
    <ul class="note-list">
      <li>${icon("check")}<span>One odd day never counts. A change has to show up on at least 3 of your last 5 days.</span></li>
      <li>${icon("check")}<span>It looks at walking pace, how even your steps are, time on both feet, sway while standing, and how long it takes to stand up.</span></li>
      <li>${icon("check")}<span>When things change, it tells you first in plain words. Family and your clinician see only what you've chosen to share.</span></li>
    </ul>
    <p class="footnote">${state.api.nonClinical}</p>
    <button class="btn block" @click=${closeSheet}>Got it</button>
  </div>`;
}

function helpSheet() {
  return html`<div class="stack">
    <h2>Ask your circle for help?</h2>
    <p class="ink-2">Steady will alert the people in your care circle right away. If you are hurt or it's an emergency, call 911.</p>
    <button class="btn danger block" @click=${async () => {
      closeSheet();
      await state.api.postEvent({ kind: "help", at: new Date().toISOString(), detail: { from: "button" } }).catch(() => {});
      senseService.vibrate("success");
      invalidate("me:");
      toast("Your circle has been alerted.");
    }}>${icon("bell")} Alert my circle now</button>
    <a class="btn block" href="tel:911">${icon("phone")} Call 911</a>
    <button class="btn ghost block" @click=${closeSheet}>Cancel</button>
  </div>`;
}

export function errorCard(e) {
  return html`<section class="card stack-sm">
    <h3>Couldn't load your data</h3>
    <p class="muted">${e?.needSignIn ? "Sign in to continue." : e?.message ?? "Check your connection and try again."}</p>
    <button class="btn" @click=${() => invalidate("")}>${icon("refresh")} Try again</button>
  </section>`;
}

export { ago };
