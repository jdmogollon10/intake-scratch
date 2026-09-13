/* Shared RSS/Atom reading. Extracted from refresh-feeds.mjs so the deal wire
   uses the same parser the tiles do — feeds are irregular in practice, so every
   extractor degrades to null rather than guessing. No dependencies. */

export const UA =
  "Mozilla/5.0 (compatible; INTAKE/1.0; +https://github.com/jdmogollon10/intake-scratch)";

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " " };

export function decode(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+|#\d+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every <item> (RSS) or <entry> (Atom) block, in feed order. */
export function entries(xml) {
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi);
  if (items && items.length) return items;
  return xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
}

/** The newest entry only. */
export function firstEntry(xml) {
  return entries(xml)[0] ?? null;
}

export function tag(block, name) {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(block);
  return m ? decode(m[1]) : null;
}

export function link(block) {
  // Atom: prefer rel="alternate" over rel="self"
  for (const [, attrs] of block.matchAll(/<link\b([^>]*)\/?>/gi)) {
    const rel = /rel\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    if (href && (!rel || rel === "alternate")) return decode(href);
  }
  const rss = tag(block, "link");
  if (rss && /^https?:/i.test(rss)) return rss;
  const guid = tag(block, "guid");
  if (guid && /^https?:/i.test(guid)) return guid;
  return null;
}

export function when(block) {
  for (const t of ["pubDate", "published", "updated", "dc:date", "date"]) {
    const raw = tag(block, t);
    if (!raw) continue;
    const ms = Date.parse(raw);
    if (!Number.isNaN(ms)) return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
  }
  return null;
}

export async function get(url, timeoutMs = 25_000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
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

/** One retry — feeds flake. Returns null rather than throwing. */
export async function getRetry(url) {
  try {
    return await get(url);
  } catch {
    try {
      return await get(url);
    } catch {
      return null;
    }
  }
}
