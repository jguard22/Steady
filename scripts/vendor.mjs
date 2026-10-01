// Bundle the one runtime dependency (Lit) into vendor/lit.js so the app runs
// from static hosting with no build step and no CDN at runtime.
import { build } from "esbuild";
import { writeFileSync, mkdirSync } from "node:fs";

mkdirSync("vendor", { recursive: true });
writeFileSync("vendor/.entry.js", `
export { html, svg, render, nothing, noChange } from "lit";
export { LitElement, css } from "lit";
export { repeat } from "lit/directives/repeat.js";
export { classMap } from "lit/directives/class-map.js";
export { styleMap } from "lit/directives/style-map.js";
export { live } from "lit/directives/live.js";
export { ref, createRef } from "lit/directives/ref.js";
export { unsafeSVG } from "lit/directives/unsafe-svg.js";
export { ifDefined } from "lit/directives/if-defined.js";
export { keyed } from "lit/directives/keyed.js";
`);
await build({
  entryPoints: ["vendor/.entry.js"],
  bundle: true,
  format: "esm",
  minify: true,
  outfile: "vendor/lit.js",
  legalComments: "inline",
  banner: { js: "/* Lit 3 — BSD-3-Clause, Copyright Google LLC. Bundled for Steady. */" },
});
console.log("vendor/lit.js written");
