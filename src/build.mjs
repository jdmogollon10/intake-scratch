#!/usr/bin/env node
/* Build index.html from src/template.html + data/*.json.
   Pure and deterministic: same inputs -> byte-identical output. No network. */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

const DATA = {
  meta: read("data/meta.json"),
  sources: read("data/sources.json"),
  live: read("data/live.json"),
  deals: read("data/deals.json"),
  brief: read("data/brief.json"),
  ref: read("data/ref.json"),
};

/* ---- sanity gates: never publish a structurally broken page ---- */
const groups = Object.keys(DATA.sources);
const sourceCount = groups.reduce((n, g) => n + DATA.sources[g].length, 0);
const fail = [];

if (sourceCount !== 70) fail.push(`expected 70 sources, found ${sourceCount}`);
if (!Array.isArray(DATA.deals)) fail.push("deals is not an array");
if (!DATA.brief || typeof DATA.brief !== "object") fail.push("brief is not an object");
if (!DATA.meta.refreshed) fail.push("meta.refreshed is empty");

// every live key must name a real source, or a tile silently goes missing
const names = new Set(groups.flatMap((g) => DATA.sources[g].map((r) => r[0])));
for (const k of Object.keys(DATA.live)) {
  if (!names.has(k)) fail.push(`live.json has "${k}", which is not in sources.json`);
}
for (const d of DATA.deals) {
  for (const f of ["src", "type", "industry", "region", "value", "title", "link", "date"]) {
    if (!(f in d)) fail.push(`a deal row is missing "${f}": ${JSON.stringify(d).slice(0, 80)}`);
  }
}

if (fail.length) {
  console.error("build refused — data failed validation:");
  for (const f of fail) console.error("  - " + f);
  process.exit(1);
}

/* Browser-tab icon. Drop a file at assets/favicon.svg (or .png / .ico) and it is
   used automatically; with no file we fall back to the 🗞️ emoji so the tab is never
   blank. Whatever lands in assets/ is copied to the published site by the workflow. */
const FAVICONS = [
  ["assets/favicon.svg", "image/svg+xml"],
  ["assets/favicon.png", "image/png"],
  ["assets/favicon.ico", "image/x-icon"],
  ["assets/favicon.jpg", "image/jpeg"],
];
const found = FAVICONS.find(([f]) => existsSync(join(ROOT, f)));
const favicon = found
  ? `<link rel="icon" type="${found[1]}" href="${found[0]}">`
  : `<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22%3E%3Ctext y=%22.9em%22 font-size=%2290%22%3E%F0%9F%97%9E%EF%B8%8F%3C/text%3E%3C/svg%3E">`;

/* `</script>` inside a string would close the tag early; escaping < prevents it. */
const payload = JSON.stringify(DATA).replace(/</g, "\\u003c");

const tpl = readFileSync(join(ROOT, "src/template.html"), "utf8");
for (const marker of ["__INTAKE_DATA__", "__FAVICON__"]) {
  if (!tpl.includes(marker)) {
    console.error(`build refused — template has no ${marker} marker`);
    process.exit(1);
  }
}

writeFileSync(
  join(ROOT, "index.html"),
  tpl.replace("__INTAKE_DATA__", payload).replace("__FAVICON__", favicon)
);

const withData = Object.values(DATA.live).filter((v) => v && v[2]).length;
console.log(
  `built index.html — ${sourceCount} sources (${withData} with an item), ` +
    `${DATA.deals.length} deals, brief ${DATA.brief.status === "live" ? DATA.brief.session : "pending"}` +
    `, favicon ${found ? found[0] : "emoji fallback"}`
);
