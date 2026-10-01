// Headless smoke + screenshots: node scripts/shoot.mjs <outdir> <route> [<route> ...]
// Each route: "#/demo/wearer" or "name=#/path" ; options via env: W, H, DARK=1, WAIT (ms), CLICKS (json)
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pwPath = process.env.PW || `${process.env.HOME}/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core`;
const { chromium } = require(pwPath);

const [outdir, ...routes] = process.argv.slice(2);
const base = process.env.BASE || "http://127.0.0.1:5199/";
const W = Number(process.env.W || 414), H = Number(process.env.H || 896);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: process.env.DARK ? "dark" : "light", deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
const hard = setTimeout(() => { console.error("HARD TIMEOUT"); process.exit(2); }, Number(process.env.HARD || 90000));
let first = true;
for (const r of routes) {
  const [name, hash] = r.includes("=") ? r.split("=") : [r.replace(/[^a-z0-9]+/gi, "_"), r];
  if (first || hash.startsWith("#/demo")) {
    await page.goto(base + hash, { timeout: 15000 });
    first = false;
  } else {
    await page.evaluate((h) => { location.hash = h; }, hash);
  }
  await page.waitForTimeout(Number(process.env.WAIT || 1200));
  if (process.env.CLICK) { for (const sel of process.env.CLICK.split("||")) { try { await page.click(sel, { timeout: 3000 }); await page.waitForTimeout(700); } catch (e) { errors.push(`click ${sel}: ${e.message.split("\n")[0]}`); } } }
  await page.screenshot({ path: `${outdir}/${name}.png`, fullPage: !process.env.VIEWPORT, timeout: 10000 });
  console.log("shot", name);
}
clearTimeout(hard);
console.log(errors.length ? errors.join("\n") : "no errors");
await browser.close();
