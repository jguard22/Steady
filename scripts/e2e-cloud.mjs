// End-to-end: Steady (signed-in mode) against a local /v1/steady API.
//   API=http://127.0.0.1:3001 JWT_SECRET=… node scripts/e2e-cloud.mjs <outdir>
// Registers three accounts, seeds five weeks of the wearer's days, then
// drives the wearer, family and clinician UIs through invites, alerts,
// time logs and the home program.
import { createRequire } from "node:module";
import { createHmac, randomBytes } from "node:crypto";
import { buildPersona, PERSONAS, localToday } from "../src/data/demo.js";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || `${process.env.HOME}/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core`);
const API = process.env.API || "http://127.0.0.1:3001";
const APP = process.env.APP || "http://127.0.0.1:5199/";
const out = process.argv[2] || ".";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function jwt(sub) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64({ alg: "HS256", typ: "JWT" }), p = b64({ sub, type: "access", iat: now, exp: now + 3600 });
  return `${h}.${p}.${createHmac("sha256", process.env.JWT_SECRET).update(`${h}.${p}`).digest("base64url")}`;
}
async function call(token, method, path, body) {
  const r = await fetch(`${API}/v1${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = r.status === 204 ? null : await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(j)}`);
  return j;
}
const ok = (cond, msg) => { if (!cond) { console.error("FAIL", msg); failures++; } else console.log("ok  ", msg); };
let failures = 0;

// ---------- accounts ----------
const users = {};
for (const role of ["wearer", "family", "clinician"]) {
  const email = `steady-e2e-${role}-${randomBytes(3).toString("hex")}@example.com`;
  const r = await fetch(`${API}/v1/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "correct-horse-battery" }) });
  const j = await r.json();
  const id = j.userId ?? j.user?.id ?? j.id;
  if (!id) throw new Error(`register failed: ${JSON.stringify(j)}`);
  users[role] = { id, email, token: jwt(id) };
}
console.log("accounts", Object.fromEntries(Object.entries(users).map(([k, v]) => [k, v.id])));

// ---------- wearer data ----------
const W = users.wearer.token;
const persona = buildPersona(PERSONAS.margaret, localToday());
await call(W, "PUT", "/steady/me/profile", { displayName: "Margaret", birthYear: 1948, sex: "female" });
for (let i = 0; i < persona.days.length; i += 31) {
  const r = await call(W, "PUT", "/steady/me/days", { days: persona.days.slice(i, i + 31) });
  if (i + 31 >= persona.days.length) ok(r.evaluation.status === "review", `server evaluation after upload = ${r.evaluation.status}`);
}
for (const e of persona.events.filter((x) => x.kind !== "note")) await call(W, "POST", "/steady/me/events", { kind: e.kind, at: e.at, detail: e.detail, ...(e.outcome ? { outcome: e.outcome } : {}) });
for (const c of persona.checks.slice(-4)) await call(W, "POST", "/steady/me/checks", { takenAt: c.takenAt, results: c.results, summary: { score: c.score } });

const famInvite = (await call(W, "POST", "/steady/me/circle/invites", { role: "family" })).invite;
const clinInvite = (await call(W, "POST", "/steady/me/circle/invites", { role: "clinician" })).invite;

// ---------- browser ----------
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
async function asRole(role, hash, { w = 414, h = 896 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${role}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`${role} console: ${m.text()}`); });
  await page.goto(APP + "README.md");
  await page.evaluate(async ({ token, api, role }) => {
    localStorage.setItem("steady.apiBase", JSON.stringify(api));
    localStorage.setItem("steady.session", JSON.stringify({ role, mode: "cloud" }));
    await new Promise((res, rej) => {
      const req = indexedDB.open("steady", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("kv");
      req.onsuccess = () => {
        const t = req.result.transaction("kv", "readwrite");
        t.objectStore("kv").put({ access: token, refresh: null, expiresAt: Date.now() + 3600e3, user: { name: role } }, "auth");
        t.oncomplete = res; t.onerror = rej;
      };
      req.onerror = rej;
    });
  }, { token: users[role].token, api: API, role });
  await page.goto(APP + hash);
  await page.waitForTimeout(1800);
  return page;
}
const shot = (page, name) => page.screenshot({ path: `${out}/${name}.png`, fullPage: true });

// wearer
let p = await asRole("wearer", "#/today");
ok(/Worth a check-in/.test(await p.textContent("main")), "wearer Today shows the server's status");
await shot(p, "e2e-wearer-today");
await p.goto(APP + "#/circle"); await p.waitForTimeout(1200);
ok((await p.textContent("main")).includes("Waiting to join"), "wearer sees pending invites");
await shot(p, "e2e-wearer-circle");

// family joins with the code through the UI
p = await asRole("family", `#/join?code=${famInvite.code}`);
await p.click("button.btn.primary:has-text(\"Join\")"); await p.waitForTimeout(1500);
await shot(p, "e2e-family-after-join");
console.log("family after join:", (await p.textContent("body")).replace(/\s+/g, " ").slice(0, 300));
ok((await p.textContent("body")).includes("Margaret"), "family joined via code and sees Margaret");
await p.goto(APP + `#/p/${users.wearer.id}`); await p.waitForTimeout(1500);
const famText = await p.textContent("main");
ok(famText.includes("Walking less than usual"), "family sees plain-language change");
ok(!/m\/s this week/.test(famText), "family doesn't see gait numbers (scope)");
await shot(p, "e2e-family-person");

// clinician joins, sees panel + patient, logs time, sets program
p = await asRole("clinician", `#/join?code=${clinInvite.code}`, { w: 1440, h: 900 });
await p.click("button.btn.primary:has-text(\"Join\")"); await p.waitForTimeout(1500);
await p.goto(APP + "#/panel"); await p.waitForTimeout(1500);
ok((await p.textContent("main")).includes("Margaret"), "clinician panel lists Margaret");
await shot(p, "e2e-clinic-panel");
await p.goto(APP + `#/patient/${users.wearer.id}/overview`); await p.waitForTimeout(1800);
ok((await p.textContent("main")).includes("This week vs usual"), "clinician overview renders change map");
await shot(p, "e2e-clinic-overview");
await p.goto(APP + `#/patient/${users.wearer.id}/checks`); await p.waitForTimeout(1200);
await shot(p, "e2e-clinic-checks");
await p.goto(APP + `#/patient/${users.wearer.id}/month`); await p.waitForTimeout(1200);
await p.click("text=Add time manually"); await p.waitForTimeout(500);
await p.fill("#tn", "Reviewed sway and rise-time trend after medicine change");
await p.click(".sheet >> text=Save"); await p.waitForTimeout(1500);
const t = await call(users.clinician.token, "GET", `/steady/people/${users.wearer.id}/time`);
ok(t.totalMinutes === 5 && t.entries.length === 1, `time log saved through the UI (${t.totalMinutes} min)`);
await shot(p, "e2e-clinic-month");
await p.goto(APP + `#/patient/${users.wearer.id}/program`); await p.waitForTimeout(1200);
await p.locator("label:has-text('Heel raises') .switch span").click(); await p.waitForTimeout(1500);
const me = await call(W, "GET", "/steady/me");
ok((me.profile.program?.exercises ?? []).includes("heelRaise"), "clinician program change reaches the wearer");

// possible fall → urgent alert for family, then ack
await call(W, "POST", "/steady/me/events", { kind: "possibleFall", at: new Date().toISOString(), outcome: "noResponse", detail: { impactG: 3 } });
p = await asRole("family", `#/p/${users.wearer.id}`);
ok((await p.textContent("main")).includes("Possible fall"), "family sees the urgent possible-fall alert");
await shot(p, "e2e-family-urgent");
await p.click("text=I've checked on"); await p.waitForTimeout(500);
await p.click(".sheet >> text=Done"); await p.waitForTimeout(1500);
const alerts = await call(users.family.token, "GET", `/steady/people/${users.wearer.id}/alerts`);
console.log("alerts:", alerts.alerts.map((a) => `${a.kind}/${a.status}`).join(", "));
await shot(p, "e2e-family-after-ack");
ok(alerts.alerts.some((a) => a.kind === "possibleFall" && a.status === "acked"), "family acknowledged the alert");

// wearer's Move shows the clinician's program
p = await asRole("wearer", "#/move");
ok((await p.textContent("main")).includes("Chosen for you"), "wearer Move shows exercises chosen by clinician");
await shot(p, "e2e-wearer-move");

await browser.close();
console.log(errors.length ? `PAGE ERRORS:\n${errors.join("\n")}` : "no page errors");
console.log(failures ? `${failures} FAILED` : "ALL PASSED");
process.exit(failures || errors.length ? 1 : 0);
