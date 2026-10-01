// Shared summary + alert logic for the on-device and demo back ends. The
// cloud computes the same thing server-side with the same rules.

import { evaluate, addDays } from "../engine/baseline.js";

export const NON_CLINICAL =
  "Steady shows everyday measurements and changes from this person's own usual. It does not diagnose, treat or predict falls.";

export const SCOPES = ["status", "activity", "alerts", "checks", "gait", "balance", "events", "program"];
export const DEFAULT_SCOPES = {
  family: ["status", "activity", "alerts", "checks"],
  clinician: SCOPES,
};
export const SCOPE_TEXT = {
  status: "How they're doing overall, and what changed",
  activity: "Walking time and steps",
  alerts: "Alerts, like a possible fall",
  checks: "Steady Check results",
  gait: "Detailed walking measures",
  balance: "Balance, sway and standing up",
  events: "Dizziness log, medicine changes and notes",
  program: "Set check-ins, exercises and alert sensitivity",
};

/** Alerts implied by stored events + the current evaluation. */
export function deriveAlerts(person, evaluation, today) {
  const alerts = [...(person.alerts ?? [])];
  const have = new Set(alerts.map((a) => a.eventId).filter(Boolean));
  for (const e of person.events ?? []) {
    if (have.has(e.id)) continue;
    if (e.kind === "possibleFall") {
      const answered = e.outcome === "ok";
      alerts.push({
        id: `al-${e.id}`, eventId: e.id, kind: e.outcome === "needHelp" ? "help" : "possibleFall", severity: "urgent",
        title: answered ? "Possible fall — answered “I'm OK”" : e.outcome === "needHelp" ? "Asked for help after a possible fall" : "Possible fall — no answer",
        detail: e.detail, createdAt: e.at, status: answered ? "resolved" : "open",
      });
    } else if (e.kind === "help") {
      alerts.push({ id: `al-${e.id}`, eventId: e.id, kind: "help", severity: "urgent", title: "Asked for help", detail: e.detail, createdAt: e.at, status: "open" });
    }
  }
  if (evaluation && (evaluation.status === "review" || evaluation.status === "watch")) {
    const key = `status-${evaluation.status}-${evaluation.asOf}`;
    if (!alerts.some((a) => a.kind === "status" && a.dedupe === key)) {
      const first = evaluation.notes[0];
      alerts.push({
        id: `al-${person.profile.userId}-${key}`, dedupe: key, kind: "status", severity: evaluation.status,
        title: evaluation.status === "review" ? "Several changes from usual — worth a check-in" : "A few changes from usual",
        detail: { notes: evaluation.notes.slice(0, 3).map((n) => n.text), first: first?.detail },
        createdAt: new Date(`${addDays(today, -1)}T19:00:00`).toISOString(), status: "open",
      });
    }
  }
  const last = evaluation?.coverage?.lastSeen;
  if (last && last < addDays(today, -1)) {
    alerts.push({ id: `al-nodata-${person.profile.userId}`, kind: "noData", severity: "info", title: "No insole data for a few days", detail: { lastSeen: last }, createdAt: new Date().toISOString(), status: "open", computed: true });
  }
  return alerts.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function personSummary(person, asOf, scopes = SCOPES) {
  const events = (person.events ?? []).map((e) => ({ ...e, date: e.date ?? e.at.slice(0, 10) }));
  const evaluation = evaluate(person.days, asOf, { events });
  const alerts = deriveAlerts({ ...person, events }, evaluation, asOf);
  const days = person.days.filter((d) => d.date > addDays(asOf, -35)).sort((a, b) => (a.date < b.date ? -1 : 1));
  return filterScopes({
    profile: person.profile,
    evaluation,
    days,
    checks: [...(person.checks ?? [])].sort((a, b) => (a.takenAt < b.takenAt ? 1 : -1)).slice(0, 8),
    events: events.sort((a, b) => (a.at < b.at ? 1 : -1)),
    alerts,
    openAlerts: alerts.filter((a) => a.status === "open").length,
    plan: person.profile.plan,
    nonClinical: NON_CLINICAL,
  }, scopes);
}

export function filterDay(d, scopes) {
  const out = { date: d.date, algo: d.algo };
  if (scopes.includes("activity")) { out.minutes = d.minutes; out.steps = d.steps; }
  if (scopes.includes("gait")) out.gait = d.gait;
  if (scopes.includes("balance")) { out.balance = d.balance; out.transitions = d.transitions; }
  out.events = scopes.includes("events") ? d.events : { possibleFalls: d.events?.possibleFalls ?? 0 };
  return out;
}

export function filterScopes(s, scopes) {
  if (scopes.length === SCOPES.length) return s;
  const out = { ...s, scopes };
  out.days = s.days.map((d) => filterDay(d, scopes));
  if (!scopes.includes("checks")) out.checks = [];
  if (!scopes.includes("events")) out.events = s.events.filter((e) => e.kind === "possibleFall" || e.kind === "help");
  if (!scopes.includes("alerts")) { out.alerts = []; out.openAlerts = 0; }
  if (!scopes.includes("gait") || !scopes.includes("balance")) {
    out.evaluation = {
      ...s.evaluation,
      metrics: s.evaluation.metrics.filter((m) => {
        const g = { cadence: "gait", gaitSpeed: "gait", strideLength: "gait", strideCv: "gait", doubleSupport: "gait", stepAsym: "gait", sway: "balance", riseTime: "balance", unsteady: "gait", walkMin: "activity", steps: "activity" }[m.key];
        return scopes.includes(g);
      }),
    };
  }
  return out;
}

export function ageOf(birthYear, today = new Date()) {
  return birthYear ? today.getFullYear() - birthYear : null;
}
