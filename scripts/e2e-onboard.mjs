// End-to-end onboarding against a local /v1/steady API (email disabled):
//   API=http://127.0.0.1:3002 JWT_SECRET=… PGDB=bw_onboard node scripts/e2e-onboard.mjs <outdir>
// The test DB only holds a hash of each sign-in code; this harness recovers
// the code by hashing all 10^6 candidates (the same rule as the server), so
// no code is ever logged or exposed by the API.
import { createRequire } from "node:module";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || `${process.env.HOME}/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core`);
const API = process.env.API || "http://127.0.0.1:3002";
const APP = process.env.APP || "http://127.0.0.1:5199/";
const out = process.argv[2] || ".";
const PEPPER = createHmac("sha256", process.env.JWT_SECRET).update("steady-email-code-pepper:v1").digest("hex");
const tag = randomBytes(3).toString("hex");
let failures = 0;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failures++; };

function psql(sql) {
  return execFileSync("docker", ["exec", "cloud_app-db-1", "psql", "-U", "bwcloud", "-d", process.env.PGDB || "bw_onboard", "-tAc", sql], { encoding: "utf8" }).trim();
}
async function codeFor(email) {
  for (let i = 0; i < 40; i++) {
    const h = psql(`select "codeHash" from "SteadyEmailCode" where email='${email.toLowerCase()}' and "consumedAt" is null order by "createdAt" desc limit 1`);
    if (h) {
      for (let n = 0; n < 1e6; n++) {
        const c = String(n).padStart(6, "0");
        if (createHash("sha256").update(`${email.toLowerCase()}:${c}:${PEPPER}`).digest("hex") === h) return c;
      }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no code for ${email}`);
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
async function newPage(w = 414, h = 896) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|status of 4\d\d/.test(m.text())) errors.push(m.text()); });
  await page.goto(APP + "README.md");
  await page.evaluate((api) => localStorage.setItem("steady.apiBase", JSON.stringify(api)), API);
  return page;
}
const text = async (p) => (await p.textContent("body")).replace(/\s+/g, " ");
const shot = (p, n) => p.screenshot({ path: `${out}/${n}.png`, fullPage: true });

// 1. A brand-new wearer: name + email → code → Today with the checklist.
const wearerEmail = `jeff.e2e.${tag}@example.com`;
let w = await newPage();
await w.goto(APP + "#/start/wearer"); await w.waitForTimeout(600);
await w.fill("#ob-name", "Jeff");
await w.fill("#ob-email", wearerEmail);
await w.click("button:has-text('Email me a code')");
await w.waitForSelector("#ob-code", { timeout: 8000 });
ok(/Check your email/.test(await text(w)), "wearer sees the 'check your email' step");
await shot(w, "onb-1-code");
await w.fill("#ob-code", await codeFor(wearerEmail));   // 6 digits auto-submit
await w.waitForTimeout(2500);
ok(/Getting started/.test(await text(w)) && /Good (morning|afternoon|evening), Jeff/.test(await text(w)), "new wearer lands on Today with name + Getting started");
await shot(w, "onb-2-today");

// 2. The wearer invites Melanie by name + email.
await w.goto(APP + "#/circle"); await w.waitForTimeout(1000);
await w.click("button:has-text('Invite family')"); await w.waitForTimeout(400);
await w.fill("#inv-name", "Melanie");
await w.fill("#inv-email", `melanie.e2e.${tag}@example.com`);
await w.click("button:has-text('Send invite')"); await w.waitForTimeout(1500);
const inviteText = await text(w);
const code = (inviteText.match(/\b([A-Z0-9]{4})-([A-Z0-9]{4})\b/) || []).slice(1).join("");
ok(code.length === 8, `invite created (${code ? "code shown" : "no code"})`);
await shot(w, "onb-3-invite");

// 3. Melanie opens the invite link → sees who invited her → code → in Jeff's circle.
const melEmail = `melanie.e2e.${tag}@example.com`;
let m = await newPage();
await m.goto(APP + `#/join?code=${code}&e=${encodeURIComponent(melEmail)}&n=Melanie`); await m.waitForTimeout(1500);
ok(/Jeff invited you to their Steady circle/.test(await text(m)), "invitee sees 'Jeff invited you'");
ok((await m.inputValue("#ob-email")) === melEmail && (await m.inputValue("#ob-name")) === "Melanie", "email and name are pre-filled from the link");
await shot(m, "onb-4-join");
await m.click("button:has-text('Email me a code')");
await m.waitForSelector("#ob-code", { timeout: 8000 });
await m.fill("#ob-code", await codeFor(melEmail)); await m.waitForTimeout(2500);
ok(/#\/p\//.test(m.url()) && /Jeff/.test(await text(m)), "Melanie joined and lands on Jeff's page");
await shot(m, "onb-5-family");
await w.click(".sheet >> text=Done").catch(() => {});
const wearerCircle = await (async () => { await w.goto(APP + "#/today"); await w.waitForTimeout(400); await w.goto(APP + "#/circle"); await w.waitForTimeout(1200); return text(w); })();
ok(/Melanie/.test(wearerCircle), "Jeff's circle now lists Melanie");

// 4. The "Open Steady" button in the code email signs in by itself.
const rexEmail = `rex.e2e.${tag}@example.com`;
const inv2 = await (async () => {
  await w.click("button:has-text('Invite clinician')"); await w.waitForTimeout(300);
  await w.fill("#inv-name", "Dr Rex");
  await w.click("button:has-text('Send invite')"); await w.waitForTimeout(1200);
  return ((await text(w)).match(/\b([A-Z0-9]{4})-([A-Z0-9]{4})\b/) || []).slice(1).join("");
})();
let r = await newPage(1280, 860);
const start = await fetch(`${API}/v1/steady/auth/email/start`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: rexEmail, invite: inv2 }) });
ok(start.ok, "code requested for the clinician");
const rexCode = await codeFor(rexEmail);
await r.goto(APP + `#/code?e=${encodeURIComponent(rexEmail)}&c=${rexCode}&i=${inv2}`); await r.waitForTimeout(3000);
ok(/#\/patient\//.test(r.url()), "email link signs the clinician in and opens Jeff's patient page");
await shot(r, "onb-6-clinician");

// 5. An unverified portal account (Melanie's situation) signs in with a code.
const oldEmail = `old.e2e.${tag}@example.com`;
await fetch(`${API}/v1/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: oldEmail, password: "squatters-password-1" }) });
psql(`update "User" set "emailVerified"=false where email='${oldEmail}'`);
let o = await newPage();
await o.goto(APP + "#/start/family"); await o.waitForTimeout(500);
await o.fill("#ob-email", oldEmail);
await o.click("button:has-text('Email me a code')");
await o.waitForSelector("#ob-code", { timeout: 8000 });
await o.fill("#ob-code", await codeFor(oldEmail)); await o.waitForTimeout(2500);
ok(/People you look out for/.test(await text(o)), "unverified portal account signs in with a code");
const login = await fetch(`${API}/v1/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: oldEmail, password: "squatters-password-1" }) });
ok(login.status === 401, `the pre-existing password no longer works (${login.status})`);
ok(psql(`select "emailVerified" from "User" where email='${oldEmail}'`) === "t", "account is now verified");

// 6. A wrong code is explained, not silent.
let x = await newPage();
await x.goto(APP + "#/start/family"); await x.waitForTimeout(400);
await x.fill("#ob-email", `wrong.e2e.${tag}@example.com`);
await x.click("button:has-text('Email me a code')");
await x.waitForSelector("#ob-code", { timeout: 8000 });
await x.fill("#ob-code", "000000"); await x.waitForTimeout(1500);
ok(/didn't work|expired/.test(await text(x)), "wrong code shows a clear message");

await browser.close();
console.log(errors.length ? `PAGE ERRORS:\n${errors.join("\n")}` : "no page errors");
console.log(failures ? `${failures} FAILED` : "ALL PASSED");
process.exit(failures || errors.length ? 1 : 0);
