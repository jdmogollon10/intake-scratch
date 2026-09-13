#!/usr/bin/env node
/* Rebuild data/deals.json — the M&A wire — from deal-carrying RSS feeds.

   WHAT THIS IS AND IS NOT
   This is mechanical extraction, not editorial judgement. It reads feeds, keeps
   items whose headline is actually about a transaction, and pulls out what can be
   read off the text with confidence: source, date, link, headline, and a deal value
   when the headline states one.

   `type`, `industry` and `region` are keyword-derived from the headline. They are a
   convenience, not analysis — anything the keywords do not clearly match is left as
   "—" rather than guessed at. A wrong label is worse than a blank one.

   Nothing here is ever invented: no value is estimated, no headline rewritten. A
   feed that fails is skipped and the previous wire is kept. */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { entries, tag, link, when, getRetry } from "./feed.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PREV = JSON.parse(readFileSync(join(ROOT, "data/deals.json"), "utf8"));

const MAX_ROWS = 18;
const MAX_AGE_DAYS = 21;

/* Feeds that actually carry transactions. Kept here rather than in sources.json
   because the tile board and the deal wire want different things from the same web. */
const FEEDS = [
  { src: "PE Hub", url: "https://www.pehub.com/feed/" },
  { src: "PE Wire", url: "https://www.privateequitywire.co.uk/feed/" },
  { src: "ACG", url: "https://middlemarketgrowth.org/feed/" },
  { src: "PR Newswire", url: "https://www.prnewswire.com/rss/financial-services-latest-news/acquisitions-mergers-and-takeovers-list.rss" },
  { src: "WSJ", url: "https://feeds.content.dowjones.io/public/rss/WSJcomUSBusiness" },
  { src: "WSJ", url: "https://feeds.content.dowjones.io/public/rss/RSSMarketsMain" },
  { src: "MarketWatch", url: "https://feeds.content.dowjones.io/public/rss/mw_topstories" },
  { src: "IPOScoop", url: "https://www.iposcoop.com/feed/" },
  { src: "Crunchbase", url: "https://news.crunchbase.com/feed/" },
  { src: "LAVCA", url: "https://www.lavca.org/feed/" },
];

/* A headline must look like a transaction to make the wire at all. */
const IS_DEAL =
  /\b(acquir\w*|acquisition|merge[rs]?|merging|takeover|take-private|buyout|buy-?out|to buy|agrees? to buy|purchases?|stake|majority stake|minority stake|invests? in|investment in|ipo|goes public|listing|spin-?off|divest\w*|carve-?out|tender offer|bid for|deal|recapitali[sz]ation|raises? \$|funding round|series [a-f]\b)/i;

/* Obvious non-transactions that still trip the words above. */
const NOT_DEAL =
  /\b(hiring|hires|appoints?|names? new|promoted|obituary|opinion|podcast|webinar|conference|award|rankings?|survey|report finds|how to|explainer|weekly wrap|roundup of)\b/i;

const TYPE_RULES = [
  [/\b(ipo|goes public|prices? its|nasdaq debut|nyse debut|listing)\b/i, "IPO"],
  [/\b(take-private|take private|to be taken private)\b/i, "Take-Private"],
  [/\b(series [a-f]\b|funding round|raises? \$|venture round)\b/i, "Financing"],
  [/\b(spin-?off|divest\w*|carve-?out|to sell)\b/i, "Divestiture"],
  [/\b(stake|investment in|invests? in)\b/i, "Strategic Investment"],
  [/\b(acquir\w*|acquisition|merge[rs]?|takeover|buyout|to buy|agrees? to buy)\b/i, "M&A"],
];

const INDUSTRY_RULES = [
  [/\b(bank|banking|insur\w*|broker\w*|fintech|payments?|lender|lending|asset manager|wealth)\b/i, "Financials"],
  [/\b(oil|gas|energy|permian|refin\w*|pipeline|solar|wind|utility|utilities|power)\b/i, "Energy"],
  [/\b(pharma\w*|biotech|bioscience|therapeutic|drug|medical|health\w*|clinical|hospital)\b/i, "Healthcare"],
  [/\b(semiconductor|chip\w*|software|saas|cloud|data cent\w*|ai\b|artificial intelligence|cyber\w*|platform|tech\w*)\b/i, "Technology"],
  [/\b(industrial|manufact\w*|aerospace|defen[cs]e|machinery|chemical|packaging|steel|auto\w*|vehicle)\b/i, "Industrials"],
  [/\b(retail\w*|consumer|restaurant|grocer\w*|beverage|food|apparel|brand)\b/i, "Consumer"],
  [/\b(real estate|property|reit|logistics|warehouse)\b/i, "Real Estate"],
  [/\b(telecom\w*|broadband|fibre|fiber|wireless|media|streaming|studio)\b/i, "Telecom & Media"],
];

const REGION_RULES = [
  [/\b(brazil\w*|brasil|s[aã]o paulo|petrobras|vale\b)\b/i, "Brazil"],
  [/\b(latin america|latam|mexic\w*|chile|colombia|argentin\w*|peru)\b/i, "LATAM"],
  [/\b(uk|british|britain|london|ftse|sterling|£)\b/i, "UK"],
  [/\b(europe\w*|german\w*|french|france|italy|italian|spain|spanish|nordic|dutch|€)\b/i, "Europe"],
  [/\b(china|chinese|japan\w*|korea\w*|india\w*|singapore|asia\w*|australia\w*)\b/i, "Asia-Pacific"],
  [/\b(us|u\.s\.|american|nasdaq|nyse|texas|california|new york)\b/i, "US"],
];

/** Only a value the headline actually states. Never estimated. */
function value(title) {
  const m =
    /([$€£])\s?([\d,]+(?:\.\d+)?)\s?(billion|bn\b|b\b|million|mn\b|m\b|trillion|tn\b)/i.exec(title);
  if (!m) return "Undisclosed";
  const [, cur, num, unit] = m;
  const u = /tr?n?|trillion/i.test(unit) ? "T" : /b/i.test(unit) ? "B" : "M";
  return `${cur}${num}${u}`;
}

const firstMatch = (rules, title, fallback = "—") =>
  rules.find(([re]) => re.test(title))?.[1] ?? fallback;

/* normalised headline, for dropping the same story arriving from two feeds */
const key = (t) => t.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).slice(0, 9).join(" ");

const cutoff = Date.now() - MAX_AGE_DAYS * 864e5;
const rows = [];
const failed = [];

for (const feed of FEEDS) {
  const xml = await getRetry(feed.url);
  if (!xml) {
    failed.push(feed.src);
    continue;
  }
  for (const block of entries(xml).slice(0, 25)) {
    const title = tag(block, "title");
    const href = link(block);
    const date = when(block);
    if (!title || !href || !date) continue;
    if (!IS_DEAL.test(title) || NOT_DEAL.test(title)) continue;
    if (Date.parse(date) < cutoff) continue;

    rows.push({
      src: feed.src,
      type: firstMatch(TYPE_RULES, title, "M&A"),
      industry: firstMatch(INDUSTRY_RULES, title),
      region: firstMatch(REGION_RULES, title),
      value: value(title),
      title,
      link: href,
      date,
    });
  }
}

if (!rows.length) {
  console.error(
    `deal refresh aborted — no deal items from any of ${FEEDS.length} feeds; ` +
      `data/deals.json left untouched.` +
      (failed.length ? ` Feeds that did not answer: ${failed.join(", ")}.` : "")
  );
  process.exit(2);
}

/* newest first, one row per story, capped */
const seen = new Set();
const wire = rows
  .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
  .filter((r) => {
    const k = key(r.title);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  })
  .slice(0, MAX_ROWS);

writeFileSync(join(ROOT, "data/deals.json"), JSON.stringify(wire, null, 1) + "\n");

const withValue = wire.filter((r) => r.value !== "Undisclosed").length;
console.log(
  `deal wire: ${wire.length} rows (was ${PREV.length}) · ${withValue} with a stated value · ` +
    `${rows.length} candidates before dedupe` +
    (failed.length ? ` · feeds that did not answer: ${failed.join(", ")}` : "")
);
