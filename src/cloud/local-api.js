// On-device back end: Steady works fully for the wearer without an account.
// Days, checks and events stay in this browser/app. Sharing needs sign-in.
import { kv } from "../store/kv.js";
import { personSummary, NON_CLINICAL } from "./summary.js";
import { evaluate } from "../engine/baseline.js";
import { defaultProgram, localToday } from "../data/demo.js";

const needAccount = () => Promise.reject(Object.assign(new Error("Sign in to share Steady with family or a clinician."), { status: 401, needSignIn: true }));

export function createLocalApi() {
  let cache = null;
  async function db() {
    if (cache) return cache;
    cache = (await kv.get("local-db")) ?? {
      profile: { userId: "local", displayName: "", plan: "HOME", settings: {}, program: defaultProgram() },
      days: [], events: [], checks: [], alerts: [],
    };
    return cache;
  }
  const save = () => kv.set("local-db", cache);
  return {
    kind: "local",
    today: localToday,
    async me() { const d = await db(); return { profile: d.profile, circle: { members: [], invites: [] }, openAlerts: 0 }; },
    async summary(asOf = localToday()) { return personSummary(await db(), asOf); },
    async days(from, to) { return (await db()).days.filter((d) => d.date >= from && d.date <= to); },
    async putDays(days) {
      const d = await db();
      for (const x of days) {
        const i = d.days.findIndex((y) => y.date === x.date);
        if (i >= 0) d.days[i] = x; else d.days.push(x);
      }
      d.days.sort((a, b) => (a.date < b.date ? -1 : 1));
      if (d.days.length > 400) d.days.splice(0, d.days.length - 400);
      await save();
      return { stored: days.length, evaluation: evaluate(d.days, localToday()) };
    },
    async checks() { return (await db()).checks; },
    async postCheck(c) { const d = await db(); const x = { id: `chk-${Date.now()}`, ...c }; d.checks.push(x); await save(); return x; },
    async events() { return (await db()).events; },
    async postEvent(e) { const d = await db(); const x = { id: `ev-${Date.now()}`, detail: {}, date: e.at.slice(0, 10), ...e }; d.events.push(x); await save(); return x; },
    async patchEvent(id, p) { const d = await db(); const x = d.events.find((e) => e.id === id); if (x) Object.assign(x, p); await save(); return x; },
    async updateProfile(p) { const d = await db(); Object.assign(d.profile, p); await save(); return d.profile; },
    circle: () => Promise.resolve({ members: [], invites: [], needSignIn: true }),
    phone: () => Promise.resolve({ phone: null, needSignIn: true }),
    invite: needAccount, revoke: needAccount, setScopes: needAccount, accept: needAccount,
    people: () => Promise.resolve([]),
    personSummary: needAccount, personDays: needAccount, ack: needAccount, addNote: needAccount,
    time: needAccount, addTime: needAccount, setPlan: needAccount, leave: needAccount,
    nonClinical: NON_CLINICAL,
  };
}
