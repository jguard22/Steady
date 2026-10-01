// Text-message onboarding UI end to end, before Twilio is configured.
//   API=http://127.0.0.1:3003 JWT_SECRET=… PGDB=bw_sms node scripts/e2e-sms.mjs <outdir>
// Only the three Twilio-backed calls are stubbed in the browser
// (/auth/options, /auth/phone/start, /auth/phone/verify); the stubbed verify
// returns REAL tokens minted by the local API's email-code flow for a fresh
// account (accepting the invite), so everything after sign-in is real.
import { createRequire } from "node:module";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || `${process.env.HOME}/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core`);
const API = process.env.API || "http://127.0.0.1:3003";
const APP = process.env.APP || "http://127.0.0.1:5199/";
const out = process.argv[2] || ".";
const PEPPER = createHmac("sha256", process.env.JWT_SECRET).update("steady-email-code-pepper:v1").digest("hex");
const tag = randomBytes(3).toString("hex");
let failures = 0;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failures++; };
const psql = (sql) => execFileSync("docker", ["exec", "cloud_app-db-1", "psql", "-U", "bwcloud", "-d", process.env.PGDB || "bw_sms", "-tAc", sql], { encoding: "utf8" }).trim();
const post = (path, body, token) => fetch(`${API}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, j: await r.json().catch(() => ({})) }));
async function codeFor(email) {
  for (let i = 0; i < 40; i++) {
    const h = psql(`select "codeHash" from "SteadyEmailCode" where email='${email}' and "consumedAt" is null order by "createdAt" desc limit 1`);
    if (h) for (let n = 0; n < 1e6; n++) { const c = String(n).padStart(6, "0"); if (createHash("sha256").update(`${email}:${c}:${PEPPER}`).digest("hex") === h) return c; }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("no code");
}
/** Real sign-in for a stand-in account (the "phone" user), joining the invite if given. */
async function realSignIn(email, invite, displayName) {
  await post("/v1/steady/auth/email/start", { email, ...(invite ? { invite } : {}) });
  const { j } = await post("/v1/steady/auth/email/verify", { email, code: await codeFor(email), ...(invite ? { invite } : {}), ...(displayName ? { displayName } : {}) });
  return j;
}

// A wearer who invites someone by mobile number.
const wearer = await realSignIn(`wearer.sms.${tag}@example.com`, null, "Jeff");
const inv = (await post("/v1/steady/me/circle/invites", { role: "family", name: "Melanie" }, wearer.access_token)).j.invite;

const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
const seen = [];
const ctx = await browser.newContext({ viewport: { width: 414, height: 896 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
await page.route("**/v1/steady/auth/options", (r) => r.fulfill({ json: { email: true, sms: true, voice: true, texts: false } }));
await page.route("**/v1/steady/auth/phone/start", async (r) => {
  const b = r.request().postDataJSON(); seen.push(["start", b]);
  r.fulfill({ json: { sent: true, invite: b.invite ? { wearerName: "Jeff", role: "family" } : null } });
});
await page.route("**/v1/steady/auth/phone/verify", async (r) => {
  const b = r.request().postDataJSON(); seen.push(["verify", b]);
  if (b.code !== "123456") return r.fulfill({ status: 400, json: { error: "invalid_code", message: "That code didn't work. Check it or send a new one." } });
  const j = await realSignIn(`melanie.sms.${tag}@example.com`, b.invite, b.displayName);
  r.fulfill({ json: { ...j, user: { ...j.user, email: undefined, phone: "+1••••••4567" } } });
});
await page.goto(APP + "README.md");
await page.evaluate((api) => localStorage.setItem("steady.apiBase", JSON.stringify(api)), API);
const text = async () => (await page.textContent("body")).replace(/\s+/g, " ");

await page.goto(APP + `#/join?code=${inv.code}&n=Melanie`); await page.waitForTimeout(1500);
ok(await page.isVisible("#ob-phone"), "mobile number is the default when texting is available");
ok(/Text me a code/.test(await text()) && /Use my email instead/.test(await text()), "'Text me a code' with an email fallback");
await page.screenshot({ path: `${out}/sms-1-start.png`, fullPage: true });
await page.fill("#ob-phone", "(312) 555-4567");
await page.click("button:has-text('Text me a code')");
await page.waitForSelector("#ob-code", { timeout: 6000 });
ok(/Check your texts/.test(await text()) && /\(312\) 555-4567/.test(await text()), "code step says 'Check your texts' with the formatted number");
ok(seen[0]?.[1]?.invite === inv.code && seen[0][1].channel === "sms", "start sent the invite and channel sms");
await page.screenshot({ path: `${out}/sms-2-code.png`, fullPage: true });
await page.fill("#ob-code", "000000"); await page.waitForTimeout(800);
ok(/didn't work/.test(await text()), "wrong code explained");
await page.fill("#ob-code", "123456"); await page.waitForTimeout(3500);
ok(/#\/p\//.test(page.url()) && /Jeff/.test(await text()), "signed in by text and joined Jeff's circle");
ok(seen.find((s) => s[0] === "verify" && s[1].code === "123456")?.[1].displayName === "Melanie", "name from the invite link was sent with the code");
await page.screenshot({ path: `${out}/sms-3-joined.png`, fullPage: true });

// Settings: add-number card (real API: no number yet), then a saved number (stubbed)
await page.goto(APP + "#/settings"); await page.waitForTimeout(1500);
ok(/Add my mobile number/.test(await text()), "Settings offers 'Add my mobile number'");
const patches = [];
await page.route("**/v1/steady/me/phone", (r) => {
  if (r.request().method() === "PATCH") { patches.push(r.request().postDataJSON()); return r.fulfill({ json: { ok: true } }); }
  r.fulfill({ json: { phone: "+1••••••4567", smsAlerts: true, marketingOptIn: false, textsAvailable: false } });
});
await page.evaluate(() => { location.hash = "#/"; }); await page.waitForTimeout(300);
await page.reload(); await page.waitForTimeout(800);
await page.evaluate(() => { location.hash = "#/settings"; }); await page.waitForTimeout(1500);
const t = await text();
ok(/\(•••\) •••-4567/.test(t) && /Text me urgent alerts/.test(t), "saved number shown masked with the alerts switch");
ok(await page.isVisible("text=Not required to use Steady") && !(await page.isChecked("section:has-text('Mobile number') input[type=checkbox] >> nth=1")), "marketing consent is a separate, unticked box");
await page.locator("section:has-text('Mobile number') input[type=checkbox]").nth(1).check(); await page.waitForTimeout(600);
ok(patches.at(-1)?.marketingOptIn === true && /Not required to use Steady/.test(patches.at(-1)?.consentText || ""), "ticking it sends the exact consent text");
await page.locator("section:has-text('Mobile number')").screenshot({ path: `${out}/sms-4-settings.png` });

// Email fallback switch on a fresh start
await page.evaluate(() => { localStorage.removeItem("steady.session"); });
await page.goto(APP + "#/start/wearer"); await page.reload(); await page.waitForTimeout(1200);
await page.click("button:has-text('Use my email instead')"); await page.waitForTimeout(300);
ok(await page.isVisible("#ob-email") && /Email me a code/.test(await text()), "switching to email works");

await browser.close();
console.log(errors.length ? `PAGE ERRORS:\n${errors.join("\n")}` : "no page errors");
console.log(failures ? `${failures} FAILED` : "ALL PASSED");
process.exit(failures || errors.length ? 1 : 0);
