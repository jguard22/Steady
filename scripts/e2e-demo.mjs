// Interactive demo flows: Steady Check (walk + chair), an exercise, the
// possible-fall screen. node scripts/e2e-demo.mjs <outdir>
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || `${process.env.HOME}/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core`);
const APP = process.env.APP || "http://127.0.0.1:5199/";
const out = process.argv[2] || ".";
let failures = 0;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failures++; };
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: 414, height: 896 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const text = async () => (await page.textContent("body")).replace(/\s+/g, " ");
const waitFor = async (re, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (re.test(await text())) return true; await page.waitForTimeout(300); } return false; };

await page.goto(APP + "#/demo/wearer"); await page.waitForTimeout(1500);

// Steady Check: weigh-in, walk, balance (skip), chair
await page.goto(APP + "#/check/run"); await page.waitForTimeout(800);
await page.click("text=Stand still and weigh in");
ok(await waitFor(/Start/, 8000), "weigh-in completes");
await page.click("button.btn.primary:has-text('Start')");
ok(await waitFor(/m\/s · \d+ steps/, 25000), "4 m walk measured from simulated insoles");
await page.screenshot({ path: `${out}/demo-check-walk.png` });
await page.click("button.btn.primary:has-text('Next')"); await page.waitForTimeout(500);
await page.click("button.btn.primary:has-text('Start')");
ok(await waitFor(/stances held/, 60000), "4-stage balance runs and stops at the first stance not held");
await page.screenshot({ path: `${out}/demo-check-balance.png` });
await page.click("button.btn.primary:has-text('Next')"); await page.waitForTimeout(500);
await page.click("button.btn.primary:has-text('Start')");
ok(await waitFor(/stands in 30 seconds/, 45000), "30-second chair stand counted");
console.log("   ", (await text()).match(/\d+ stands in 30 seconds/)?.[0]);
await page.click("button.btn.primary:has-text('Next')"); await page.waitForTimeout(500);
await page.click("text=Skip this one"); await page.waitForTimeout(400);
await page.click("text=Skip this one"); await page.waitForTimeout(1200);
ok(/All done/.test(await text()), "results screen with score");
await page.screenshot({ path: `${out}/demo-check-results.png`, fullPage: true });
await page.click("text=Done"); await page.waitForTimeout(800);

// Exercise: reach for the targets (simulated person follows the targets)
await page.goto(APP + "#/exercise/weightShift"); await page.waitForTimeout(600);
await page.click("button.btn.primary:has-text('Start')");
await page.waitForTimeout(9000);
await page.screenshot({ path: `${out}/demo-exercise-targets.png` });
ok(/of 8/.test(await text()), "target game running");
ok(await waitFor(/Nice work/, 40000), "target game completes");
await page.click("text=Back to Move"); await page.waitForTimeout(600);

// Possible fall → "Are you OK?" → I'm OK
await page.goto(APP + "#/settings"); await page.waitForTimeout(600);
await page.click("text=Practice the"); await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/demo-fall.png` });
ok(/Are you OK\?/.test(await text()), "Are you OK? screen shows");
await page.click("button:has-text(\"I'm OK\")"); await page.waitForTimeout(1200);
await page.goto(APP + "#/alerts"); await page.waitForTimeout(1000);
ok(/Possible fall/.test(await text()), "answered possible fall is logged");

// Dizzy log
await page.goto(APP + "#/today"); await page.waitForTimeout(800);
await page.click("text=I feel dizzy"); await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/demo-dizzy.png` });
await page.click("text=Just after standing up"); await page.click(".sheet >> text=Save"); await page.waitForTimeout(800);
ok(/Logged/.test(await text()), "dizziness logged");

await browser.close();
console.log(errors.length ? `PAGE ERRORS:\n${errors.join("\n")}` : "no page errors");
console.log(failures ? `${failures} FAILED` : "ALL PASSED");
process.exit(failures || errors.length ? 1 : 0);
