// Steady — app entry: session, routing, layouts.
import { html, render, nothing } from "../vendor/lit.js";
import { state, set, update, setRenderer, closeSheet, go, parseRoute } from "./app/state.js";
import { prefs } from "./store/kv.js";
import { icon, mark } from "./ui/icons.js";
import { demoBanner } from "./ui/components.js";
import { auth } from "./cloud/auth.js";
import { startSession, endSession, ROLE_HOME } from "./app/session.js";
import "./ui/charts.js";

import { welcomeView, joinView, signinView } from "./views/welcome.js";
import { todayView } from "./views/wearer/today.js";
import { moveView } from "./views/wearer/move.js";
import { checkView } from "./views/wearer/check.js";
import { exerciseView } from "./views/wearer/exercise.js";
import { myDataView } from "./views/wearer/data.js";
import { circleView } from "./views/wearer/circle.js";
import { liveView } from "./views/wearer/live.js";
import { stationView } from "./views/wearer/station.js";
import { fallOverlay, dizzySheet } from "./views/wearer/safety.js";
import { peopleView } from "./views/family/people.js";
import { personView } from "./views/family/person.js";
import { panelView } from "./views/clinic/panel.js";
import { patientView } from "./views/clinic/patient.js";
import { settingsView } from "./views/settings.js";
import { alertsView } from "./views/alerts.js";

const ROLE_BODY = { wearer: "role-wearer", family: "role-family", clinician: "role-clinic" };

// ---------- routing ----------
window.addEventListener("hashchange", () => {
  const route = parseRoute();
  if (route.path === state.route.path && JSON.stringify(route.query) === JSON.stringify(state.route.query)) return;
  set({ route, sheet: null });
  window.scrollTo({ top: 0 });
});

function view() {
  const { parts } = state.route;
  const [a, b, c] = parts;
  if (a === "signin") return signinView();
  if (a === "join") return joinView();
  if (a === "demo") { queueMicrotask(() => startDemo(b)); return nothing; }
  if (!state.role || a === "welcome" || !a) return state.role && !a ? (go(ROLE_HOME[state.role]), nothing) : welcomeView();
  if (a === "settings") return settingsView();
  if (a === "alerts") return alertsView();
  if (state.role === "wearer") {
    if (a === "today") return todayView();
    if (a === "move") return moveView();
    if (a === "check") return checkView(b);
    if (a === "exercise") return exerciseView(b);
    if (a === "data") return myDataView(b);
    if (a === "circle") return circleView();
    if (a === "live") return liveView();
    if (a === "station") return stationView();
  }
  if (state.role === "family") {
    if (a === "people") return peopleView();
    if (a === "p" && b) return personView(b, c);
  }
  if (state.role === "clinician") {
    if (a === "panel") return panelView();
    if (a === "patient" && b) return patientView(b, c);
  }
  go(ROLE_HOME[state.role]);
  return nothing;
}

// ---------- layouts ----------
const TABS = {
  wearer: [["#/today", "home", "Today"], ["#/move", "move", "Move"], ["#/data", "chart", "My data"], ["#/circle", "people", "Circle"]],
  family: [["#/people", "people", "People"], ["#/alerts", "bell", "Alerts"], ["#/settings", "settings", "Settings"]],
};

function tabbar() {
  const tabs = TABS[state.role];
  if (!tabs) return nothing;
  const here = "#" + state.route.path;
  return html`<nav class="tabbar" style="--n:${tabs.length}" aria-label="Main">
    ${tabs.map(([href, ic, label]) => html`<a href=${href} aria-current=${here.startsWith(href) || (href === "#/people" && here.startsWith("#/p/")) ? "page" : "false"}>${icon(ic)}<span>${label}</span></a>`)}
  </nav>`;
}

function topbar() {
  const alerts = state.topAlerts ?? 0;
  return html`<header class="topbar">
    <a class="brand" href=${ROLE_HOME[state.role]} aria-label="Steady home">${mark()}<span>Steady<small>by BrilliantWear</small></span></a>
    <span class="spacer"></span>
    ${state.role === "wearer" ? html`<a class="icon-btn" href="#/live" aria-label="Live insoles">${icon("foot")}${state.sense.status === "live" ? html`<span class="dot" style="background:var(--good)"></span>` : nothing}</a>` : nothing}
    <a class="icon-btn" href="#/alerts" aria-label=${`Alerts${alerts ? `, ${alerts} new` : ""}`}>${icon("bell")}${alerts ? html`<span class="dot"></span>` : nothing}</a>
    ${state.role === "wearer" ? html`<a class="icon-btn" href="#/settings" aria-label="Settings">${icon("settings")}</a>` : nothing}
  </header>`;
}

function clinicLayout(content) {
  const here = state.route.path;
  return html`<div class="clinic">
    <aside class="clinic-nav">
      <a class="brand" href="#/panel">${mark()}<span>Steady<small>for clinicians</small></span></a>
      <nav aria-label="Clinic">
        <a href="#/panel" aria-current=${here === "/panel" || here.startsWith("/patient") ? "page" : "false"}>${icon("people")} Patients</a>
        <a href="#/alerts" aria-current=${here === "/alerts" ? "page" : "false"}>${icon("bell")} Alerts ${state.topAlerts ? html`<span class="pill urgent" style="margin-left:auto;padding:2px 8px">${state.topAlerts}</span>` : nothing}</a>
        <a href="#/settings" aria-current=${here === "/settings" ? "page" : "false"}>${icon("settings")} Settings</a>
      </nav>
      <div class="nav-foot footnote">Measurements and changes from each person's own usual. Not a diagnosis.</div>
    </aside>
    <main class="clinic-main" id="main">
      ${state.mode === "demo" ? html`<div style="margin-bottom:14px">${demoBanner("you're Dr. Ana Rivera's practice", endSession)}</div>` : nothing}
      ${content}
    </main>
  </div>`;
}

function shell(content) {
  const who = { wearer: "you're Margaret, who wears the insoles", family: "you're Dana, Margaret's daughter" }[state.role];
  return html`<div class="shell">
    ${topbar()}
    ${state.mode === "demo" ? html`<div style="margin-bottom:14px">${demoBanner(who, endSession)}</div>` : nothing}
    <main id="main" class="stack">${content}</main>
  </div>${tabbar()}`;
}

function renderApp() {
  document.body.className = [ROLE_BODY[state.role] ?? "role-wearer", textClass()].join(" ");
  const content = view();
  const full = !state.role || ["welcome", "signin", "join", "station"].includes(state.route.parts[0]) || (state.route.parts[0] === "check" && state.route.parts[1]) || state.route.parts[0] === "exercise" && state.route.parts[1];
  const page = full ? content : state.role === "clinician" ? clinicLayout(content) : shell(content);
  render(html`${page}
    ${state.sheet ? html`<div class="sheet-backdrop" @click=${(e) => e.target === e.currentTarget && closeSheet()}>
      <div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${state.sheet()}</div></div>` : nothing}
    ${state.overlay?.kind === "fall" ? fallOverlay() : nothing}
    ${state.overlay?.kind === "dizzy" ? dizzySheet() : nothing}
    ${state.toast ? html`<div class="toast" role="status">${state.toast}</div>` : nothing}`, document.getElementById("app"));
}

function textClass() {
  const t = prefs.get("textSize", "normal");
  return t === "large" ? "text-large" : t === "larger" ? "text-larger" : "";
}

document.addEventListener("keydown", (e) => { if (e.key === "Escape" && state.sheet) closeSheet(); });
window.addEventListener("scroll", () => document.querySelector(".topbar")?.classList.toggle("scrolled", window.scrollY > 4), { passive: true });

function startDemo(which) {
  const role = { wearer: "wearer", family: "family", clinic: "clinician", clinician: "clinician" }[which] ?? "wearer";
  startSession({ role, mode: "demo" });
}

// ---------- boot ----------
async function boot() {
  setRenderer(renderApp);
  state.route = parseRoute();
  // OAuth return (standalone sign-in)
  const q = new URLSearchParams(location.search);
  if (q.get("code") && q.get("state")) {
    const ok = await auth.finishRedirect(q).catch(() => false);
    history.replaceState(null, "", location.pathname + (location.hash || "#/"));
    if (ok) {
      const pending = prefs.get("pendingRole", "wearer");
      const join = prefs.get("pendingJoin", null);
      prefs.del("pendingRole"); prefs.del("pendingJoin");
      startSession({ role: pending, mode: "cloud" }, { navigate: !join });
      if (join) go(`#/join?code=${encodeURIComponent(join)}`, { replace: true });
      return;
    }
  }
  if (state.route.parts[0] === "demo") { startDemo(state.route.parts[1]); return; }
  const s = prefs.get("session");
  if (s?.role) {
    if (s.mode === "cloud" && !(await auth.restore())) { update(); return; }
    // keep deep links (e.g. an invite link) instead of jumping home
    const first = state.route.parts[0];
    startSession(s, { navigate: !first || first === "welcome" });
    return;
  }
  update();
}
boot();

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
