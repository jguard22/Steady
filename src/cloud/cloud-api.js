// Steady cloud client (/v1/steady). Same methods as demo-api.js.
import { apiBase } from "./auth.js";
import { NON_CLINICAL } from "./summary.js";

export function createCloudApi({ auth }) {
  // The API treats a missing field as "not given"; only profile edits use
  // null on purpose (to clear a value), so drop top-level nulls elsewhere.
  const dropNulls = (b) => (b && typeof b === "object" && !Array.isArray(b) ? Object.fromEntries(Object.entries(b).filter(([, v]) => v !== null)) : b);
  async function call(method, path, body) {
    if (path !== "/me/profile") body = dropNulls(body);
    const token = await auth.token();
    const r = await fetch(`${apiBase()}/v1/steady${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 204) return true;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.message || j.error || `Request failed (${r.status})`), { status: r.status });
    return j;
  }
  const enc = encodeURIComponent;
  const today = () => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };
  return {
    kind: "cloud",
    today,
    async me() { return call("GET", "/me"); },
    async summary(asOf = today()) { return call("GET", `/me/summary?asOf=${asOf}`); },
    async days(from, to) { return (await call("GET", `/me/days?from=${from}&to=${to}`)).days; },
    async putDays(days) { return call("PUT", "/me/days", { days }); },
    async checks() { return (await call("GET", "/me/checks")).checks; },
    async postCheck(c) { return (await call("POST", "/me/checks", c)).check; },
    async events() { return (await call("GET", "/me/events")).events; },
    async postEvent(e) { return (await call("POST", "/me/events", e)).event; },
    async patchEvent(id, p) { return (await call("PATCH", `/me/events/${enc(id)}`, p)).event; },
    async updateProfile(p) { return (await call("PUT", "/me/profile", p)).profile; },
    async circle() { return call("GET", "/me/circle"); },
    async invite(role, { name, email } = {}) {
      const r = await call("POST", "/me/circle/invites", { role, ...(name ? { name } : {}), ...(email ? { email } : {}) });
      return { ...r.invite, emailed: !!r.emailed };
    },
    async revoke(id) { return call("DELETE", `/me/circle/${enc(id)}`); },
    async setScopes(id, scopes) { return (await call("PATCH", `/me/circle/${enc(id)}`, { scopes })).link; },
    async accept(code) { return call("POST", "/circle/accept", { code }); },
    async people() { return (await call("GET", "/people")).people; },
    async personSummary(id, asOf = today()) { return call("GET", `/people/${enc(id)}/summary?asOf=${asOf}`); },
    async personDays(id, from, to) { return (await call("GET", `/people/${enc(id)}/days?from=${from}&to=${to}`)).days; },
    async ack(id, alertId, note) { return call("POST", `/people/${enc(id)}/alerts/${enc(alertId)}/ack`, note ? { note } : {}); },
    async addNote(id, n) { return (await call("POST", `/people/${enc(id)}/notes`, n)).event; },
    async time(id, month) { return call("GET", `/people/${enc(id)}/time?month=${month}`); },
    async addTime(id, e) { return (await call("POST", `/people/${enc(id)}/time`, e)).entry; },
    async setPlan(id, p) { return (await call("PUT", `/people/${enc(id)}/plan`, p)).profile; },
    async leave(id) { return call("DELETE", `/people/${enc(id)}`); },
    nonClinical: NON_CLINICAL,
  };
}
