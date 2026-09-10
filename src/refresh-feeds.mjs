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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCES = JSON.parse(readFileSync(join(ROOT, "data/sources.json"), "utf8"));
const PREV = JSON.parse(readFileSync(join(ROOT, "data/live.json"), "utf8"));

const UA =
  "Mozilla/5.0 (compatible; INTAKE/1.0; +https://github.com/jdmogollon10/intake-scratch)";
const TIMEOUT_MS = 25_000;
const CONCURRENCY = 8;

/* ---------------------------------------------------------------- parsing */

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " " };

function decode(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+|#\d+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** First <item> (RSS) or <entry> (Atom) block, whichever appears first. */
function firstEntry(xml) {
  const m =
    /<item[\s>][\s\S]*?<\/item>/i.exec(xml) ?? /<entry[\s>][\s\S]*?<\/entry>/i.exec(xml);
  return m ? m[0] : null;
}

function tag(block, name) {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(block);
  return m ? decode(m[1]) : null;
}

function link(block) {
  // Atom: <link rel="alternate" href="..."/> — prefer alternate, else first non-self
  const atom = [...block.matchAll(/<link\b([^>]*)\/?>/gi)];
  for (const [, attrs] of atom) {
    const rel = /rel\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    if (href && (!rel || rel === "alternate")) return decode(href);
  }
  // RSS: <link>url</link>, else <guid isPermaLink="true">
  const rss = tag(block, "link");
  if (rss && /^https?:/i.test(rss)) return rss;
  const guid = tag(block, "guid");
  if (guid && /^https?:/i.test(guid)) return guid;
  return null;
}

function when(block) {
  for (const t of ["pubDate", "published", "updated", "dc:date", "date"]) {
    const raw = tag(block, t);
    if (!raw) continue;
    const ms = Date.parse(raw);
    if (!Number.isNaN(ms)) return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
  }
  return null;
}

/* ---------------------------------------------------------------- fetching */

async function get(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      redirect: "follow",
      headers: { "user-agent": UA, accept: "application/rss+xml, application/xml, text/xml, */*" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function refresh(name, feedUrl) {
  if (!feedUrl) return { name, status: "no-feed" };
  let xml;
  try {
    xml = await get(feedUrl);
  } catch (e) {
    try {
      xml = await get(feedUrl); // one retry: feeds flake
    } catch (e2) {
      return { name, status: "fetch-failed", detail: String(e2.message || e2) };
    }
  }

  const block = firstEntry(xml);
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
  `The SCREENER brief and the deal wire are written separately.`;
writeFileSync(join(ROOT, "data/meta.json"), JSON.stringify(meta, null, 1) + "\n");

console.log(`feeds ok: ${okCount}/${results.length} · changed: ${updated} · kept previous: ${kept.length}`);
for (const k of kept) console.log("  kept: " + k);
