// Render assets/icon.svg to the PNG sizes iOS and Android want.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || `${process.env.HOME}/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core`);
const svg = readFileSync("assets/icon.svg", "utf8").replace('rx="14"', 'rx="0"');
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
for (const [name, size, pad, bg] of [["icon-180", 180, 0, null], ["icon-192", 192, 0, null], ["icon-512", 512, 0, null], ["icon-512-maskable", 512, 0.12, "#00b892"]]) {
  await page.setViewportSize({ width: size, height: size });
  const inner = Math.round(size * (1 - 2 * pad));
  await page.setContent(`<html><body style="margin:0;background:${bg ?? "transparent"};display:grid;place-items:center;width:${size}px;height:${size}px">
    <div style="width:${inner}px;height:${inner}px">${svg.replace("<svg ", `<svg width="${inner}" height="${inner}" `)}</div></body></html>`);
  await page.screenshot({ path: `assets/${name}.png`, omitBackground: !bg });
  console.log(name);
}
await browser.close();
