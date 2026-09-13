#!/usr/bin/env node
/* Refresh data/live.json: for each source in data/sources.json, fetch the feed
   and record the newest item's title, link and date.

   Rules that matter more than coverage:
     - a feed that fails keeps its PREVIOUS item; it is never blanked
     - nothing is ever invented; no item means no change
     - if the whole run fails (no network), live.json is left untouched

   No dependencies: Node 18+ global fetch and a small, forgiving XML reader.
   Feeds are irregular in practice, so every extractor degrades to null. */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { entries, tag, link, when, getRetry } from "./feed.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCES = JSON.parse(readFileSync(join(ROOT, "data/sources.json"), "utf8"));
const PREV = JSON.parse(readFileSync(join(ROOT, "data/live.json"), "utf8"));

const CONCURRENCY = 8;

/* ---------------------------------------------------------------- fetch */

async function refresh(name, feedUrl) {
  if (!feedUrl) return { name, status: "no-feed" };
  const xml = await getRetry(feedUrl);
  if (!xml) return { name, status: "fetch-failed" };

  const block = entries(xml)[0] ?? null;
  if (!block) return { name, status: "no-items" };

  const title = tag(block, "title");
  if (!title) return { name, status: "no-title" };

  let href = link(block);
  // a link that just points back at the feed is useless; keep whatever we had
  if (href === feedUrl) href = PREV[name]?.[1] ?? null;

  return { name, status: "ok", item: [title, href, when(block)] };
}

/* ---------------------------------------------------------------- run */

const jobs = Object.values(SOURCES)
  .flat()
  .map((r) => ({ name: r[0], feed: r[2] }));

const results = [];
for (let i = 0; i < jobs.length; i += CONCURRENCY) {
  const batch = jobs.slice(i, i + CONCURRENCY);
  results.push(...(await Promise.all(batch.map((j) => refresh(j.name, j.feed)))));
}

const next = { ...PREV };
let updated = 0;
const kept = [];

for (const r of results) {
  if (r.status === "ok") {
    const before = JSON.stringify(next[r.name]);
    next[r.name] = r.item;
    if (JSON.stringify(r.item) !== before) updated++;
  } else {
    kept.push(`${r.name} (${r.status}${r.detail ? ": " + r.detail : ""})`);
  }
}

const okCount = results.filter((r) => r.status === "ok").length;

if (okCount === 0) {
  console.error(
    `refresh aborted — all ${results.length} feeds failed; live.json left untouched.\n` +
      `This is what a blocked network looks like, not an empty news day.`
  );
  for (const k of kept.slice(0, 5)) console.error("  - " + k);
  process.exit(2);
}

writeFileSync(join(ROOT, "data/live.json"), JSON.stringify(next, null, 1) + "\n");

const meta = JSON.parse(readFileSync(join(ROOT, "data/meta.json"), "utf8"));
meta.refreshed = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
meta.note =
  `Feeds refreshed automatically by GitHub Actions: ${okCount} of ${results.length} sources ` +
  `returned an item, ${updated} of them new since the last run. ` +
  (kept.length
    ? `${kept.length} feed${kept.length === 1 ? "" : "s"} did not answer and kept the previous item rather than being blanked: ` +
      kept.map((k) => k.split(" (")[0]).join(", ") + ". "
    : "Every feed answered. ") +
  `Nothing here was written by a model — the tiles are whatever the feeds actually returned. ` +
  `The SCREENER brief is written separately.`;
writeFileSync(join(ROOT, "data/meta.json"), JSON.stringify(meta, null, 1) + "\n");

console.log(`feeds ok: ${okCount}/${results.length} · changed: ${updated} · kept previous: ${kept.length}`);
for (const k of kept) console.log("  kept: " + k);
