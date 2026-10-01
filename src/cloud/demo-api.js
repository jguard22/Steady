// In-browser stand-in for the Steady cloud, backed by the demo personas.
// Same method names and shapes as cloud-api.js, so every screen runs on
// exactly the data contract the real service returns. Changes (acks, notes,
// invites, checks) persist for the session and show up across perspectives.

import { PERSONAS, buildPersona, buildClinicPanel, localToday, CLINICIAN, FAMILY } from "../data/demo.js";
import { personSummary, DEFAULT_SCOPES, SCOPES, filterDay, ageOf, NON_CLINICAL } from "./summary.js";
import { evaluate, addDays } from "../engine/baseline.js";

let DB = null;

function db() {
  if (DB) return DB;
  const today = localToday();
  const panel = buildClinicPanel(today);
  const walter = buildPersona(PERSONAS.walter, today);
  const people = new Map([...panel, walter].map((p) => [p.profile.userId, { ...p, alerts: [], timeLog: [] }]));
  // time already logged this month for the clinic panel
  const month = today.slice(0, 7);
  let i = 0;
  for (const p of people.values()) {
    if (p.profile.plan !== "CLINIC" && p.profile.userId !== "demo-margaret") continue;
    const n = (i++ % 4) + 1;
    for (let k = 0; k < n; k++) {
      const date = addDays(today, -((k * 6 + i) % 27));
      if (date.slice(0, 7) !== month) continue;
      p.timeLog.push({ id: `t-${p.profile.userId}-${k}`, minutes: [6, 9, 12, 5][k % 4], activity: ["review", "call", "review", "message"][k % 4], note: ["Reviewed weekly trends", "Phone check-in", "Reviewed alert", "Sent home-program update"][k % 4], at: new Date(`${date}T16:00:00`).toISOString(), by: CLINICIAN.displayName });
    }
  }
  const links = [
    { id: "lk-dana-m", wearerId: "demo-margaret", watcher: "family", role: "family", name: FAMILY.displayName, scopes: [...DEFAULT_SCOPES.family], status: "active", acceptedAt: addDays(today, -70) },
    { id: "lk-dana-w", wearerId: "demo-walter", watcher: "family", role: "family", name: FAMILY.displayName, scopes: [...DEFAULT_SCOPES.family], status: "active", acceptedAt: addDays(today, -60) },
    ...[...people.values()].filter((p) => p.profile.plan === "CLINIC" || p.profile.userId === "demo-margaret").map((p) => ({
      id: `lk-clin-${p.profile.userId}`, wearerId: p.profile.userId, watcher: "clinician", role: "clinician", name: CLINICIAN.displayName, scopes: [...SCOPES], status: "active", acceptedAt: addDays(today, -80),
    })),
  ];
  DB = { today, people, links, invites: [] };
  return DB;
}

const delay = (v) => new Promise((r) => setTimeout(() => r(structuredClone(v)), 120));

/**
 * @param {{viewer: 'wearer'|'family'|'clinician', wearerId?: string}} opts
 */
export function createDemoApi({ viewer, wearerId = "demo-margaret" }) {
  const D = db();
  const me = () => D.people.get(wearerId);
  const linkFor = (id) => D.links.find((l) => l.wearerId === id && l.watcher === viewer && l.status === "active");
  const person = (id) => {
    const l = linkFor(id);
    if (!l) throw Object.assign(new Error("Not found"), { status: 404 });
    return { p: D.people.get(id), l };
  };

  return {
    kind: "demo",
    viewer,
    today: () => D.today,

    // ---------- wearer ----------
    async me() {
      const p = me();
      const s = personSummary(p, D.today);
      return delay({ profile: p.profile, circle: circleOf(wearerId), openAlerts: s.openAlerts });
    },
    async summary(asOf = D.today) { return delay(personSummary(me(), asOf)); },
    async days(from, to) { return delay(me().days.filter((d) => d.date >= from && d.date <= to)); },
    async putDays(days) {
      const p = me();
      for (const d of days) {
        const i = p.days.findIndex((x) => x.date === d.date);
        if (i >= 0) p.days[i] = d; else p.days.push(d);
      }
      return delay({ stored: days.length, evaluation: evaluate(p.days, D.today) });
    },
    async checks() { return delay(me().checks); },
    async postCheck(check) {
      const c = { id: `chk-${Date.now()}`, ...check };
      me().checks.push(c);
      return delay(c);
    },
    async events() { return delay(me().events); },
    async postEvent(e) {
      const ev = { id: `ev-${Date.now()}`, date: e.at.slice(0, 10), detail: {}, ...e };
      me().events.push(ev);
      return delay(ev);
    },
    async patchEvent(id, patch) {
      const ev = me().events.find((e) => e.id === id);
      if (ev) Object.assign(ev, patch);
      return delay(ev);
    },
    async updateProfile(patch) {
      Object.assign(me().profile, patch);
      return delay(me().profile);
    },
    async circle() { return delay(circleOf(wearerId)); },
    async invite(role, { name, email } = {}) {
      const code = Array.from({ length: 8 }, () => "ABCDEFGHJKMNPQRSTVWXYZ23456789"[Math.floor(Math.random() * 30)]).join("");
      const inv = { id: `inv-${Date.now()}`, wearerId, role, code, label: name ?? null, emailed: !!email, scopes: [...DEFAULT_SCOPES[role]], expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(), status: "pending" };
      D.invites.push(inv);
      return delay(inv);
    },
    async revoke(linkId) {
      const l = D.links.find((x) => x.id === linkId);
      if (l) l.status = "revoked";
      D.invites = D.invites.filter((x) => x.id !== linkId);
      return delay(true);
    },
    async setScopes(linkId, scopes) {
      const l = D.links.find((x) => x.id === linkId);
      if (l) l.scopes = scopes;
      return delay(l);
    },

    // ---------- watchers ----------
    async accept(code) {
      const inv = D.invites.find((i) => i.code === code.toUpperCase().replace(/[^A-Z0-9]/g, ""));
      if (!inv) throw Object.assign(new Error("That code didn't work. Check it and try again."), { status: 404 });
      D.invites = D.invites.filter((i) => i !== inv);
      const link = { id: `lk-${Date.now()}`, wearerId: inv.wearerId, watcher: viewer, role: inv.role, name: viewer === "clinician" ? CLINICIAN.displayName : FAMILY.displayName, scopes: inv.scopes, status: "active", acceptedAt: D.today };
      D.links.push(link);
      return delay({ link, wearer: { id: inv.wearerId, displayName: D.people.get(inv.wearerId).profile.displayName } });
    },
    async people() {
      const list = D.links.filter((l) => l.watcher === viewer && l.status === "active").map((l) => {
        const p = D.people.get(l.wearerId);
        const s = personSummary(p, D.today, l.scopes);
        const today = p.days.find((d) => d.date === D.today);
        const metric = (k) => s.evaluation.metrics.find((m) => m.key === k);
        const worst = [...s.evaluation.metrics].filter((m) => m.level === "review" || m.level === "watch").sort((a, b) => (b.ewma ?? 0) - (a.ewma ?? 0))[0];
        const month = D.today.slice(0, 7);
        return {
          wearerId: l.wearerId, linkId: l.id, displayName: p.profile.displayName, role: l.role, scopes: l.scopes,
          status: s.evaluation.status, lastSeen: s.evaluation.coverage.lastSeen, openAlerts: s.openAlerts,
          urgent: s.alerts.some((a) => a.status === "open" && a.severity === "urgent"),
          today: l.scopes.includes("activity") && today ? { walkMin: today.minutes.walk, steps: today.steps } : null,
          plan: p.profile.plan, age: l.role === "clinician" ? ageOf(p.profile.birthYear) : null, tags: l.role === "clinician" ? p.profile.tags : [],
          notes: s.evaluation.notes.slice(0, 2),
          topChange: worst ? { key: worst.key, level: worst.level, changePct: worst.changePct, ewma: worst.ewma } : null,
          cadenceTrend: p.days.slice(-35).map((d) => d.gait?.cadenceSpm ?? null),
          latestCheck: [...p.checks].sort((a, b) => (a.takenAt < b.takenAt ? 1 : -1))[0]?.score ?? null,
          daysWithData: p.days.filter((d) => d.date.startsWith(month) && d.minutes?.worn > 0).length,
          minutesLogged: (p.timeLog ?? []).filter((t) => t.at.startsWith(month)).reduce((a, t) => a + t.minutes, 0),
        };
      });
      return delay(list);
    },
    async personSummary(id, asOf = D.today) {
      const { p, l } = person(id);
      return delay({ ...personSummary(p, asOf, l.scopes), link: { id: l.id, role: l.role, scopes: l.scopes } });
    },
    async personDays(id, from, to) {
      const { p, l } = person(id);
      return delay(p.days.filter((d) => d.date >= from && d.date <= to).map((d) => (l.scopes.length === SCOPES.length ? d : filterDay(d, l.scopes))));
    },
    async ack(id, alertId, note) {
      const { p } = person(id);
      const s = personSummary(p, D.today);
      const a = s.alerts.find((x) => x.id === alertId);
      if (a) {
        const stored = p.alerts.find((x) => x.id === alertId);
        const upd = { ...a, status: "acked", ackBy: viewer === "clinician" ? CLINICIAN.displayName : FAMILY.displayName, ackAt: new Date().toISOString(), ackNote: note ?? null };
        if (stored) Object.assign(stored, upd); else p.alerts.push(upd);
      }
      return delay(true);
    },
    async addNote(id, { text, kind = "note" }) {
      const { p } = person(id);
      const ev = { id: `ev-${Date.now()}`, kind, at: new Date().toISOString(), date: D.today, detail: { text, by: viewer === "clinician" ? CLINICIAN.displayName : FAMILY.displayName } };
      p.events.push(ev);
      return delay(ev);
    },
    async time(id, month = D.today.slice(0, 7)) {
      const { p } = person(id);
      const entries = (p.timeLog ?? []).filter((t) => t.at.startsWith(month)).sort((a, b) => (a.at < b.at ? 1 : -1));
      return delay({ entries, totalMinutes: entries.reduce((a, t) => a + t.minutes, 0), daysWithData: p.days.filter((d) => d.date.startsWith(month) && d.minutes?.worn > 0).map((d) => d.date) });
    },
    async addTime(id, entry) {
      const { p } = person(id);
      const e = { id: `t-${Date.now()}`, at: new Date().toISOString(), by: CLINICIAN.displayName, ...entry };
      p.timeLog.push(e);
      return delay(e);
    },
    async setPlan(id, program) {
      const { p } = person(id);
      p.profile.program = { ...p.profile.program, ...program };
      return delay(p.profile);
    },
    async leave(id) {
      const l = linkFor(id);
      if (l) l.status = "revoked";
      return delay(true);
    },
    nonClinical: NON_CLINICAL,
  };

  function circleOf(id) {
    return {
      members: D.links.filter((l) => l.wearerId === id && l.status === "active").map((l) => ({ id: l.id, role: l.role, name: l.name, scopes: l.scopes, acceptedAt: l.acceptedAt })),
      invites: D.invites.filter((i) => i.wearerId === id),
    };
  }
}

export function resetDemo() { DB = null; }
export const DEMO_IDENTITIES = { CLINICIAN, FAMILY };
