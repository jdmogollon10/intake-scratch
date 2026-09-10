# INTAKE

A markets, deals and research dashboard. One static page, rebuilt every morning.

**Live:** https://jdmogollon10.github.io/intake-scratch/

## Why it is split up

The page used to be a single HTML file that a Claude session rewrote by hand.
That worked, but the daily automation kept failing silently: the scheduled
session had no outbound network access to the feeds, so every morning it started,
found it could not fetch anything, and exited without changing a thing.

The fix is to run the mechanical half somewhere that *does* have network — a
GitHub Actions runner — and leave only the judgement half to a model.

| Part | Written by | How often |
| --- | --- | --- |
| `data/live.json` — newest item per feed | GitHub Actions, no model involved | daily, 11:00 UTC |
| `data/deals.json` — the M&A wire | Claude routine | weekday mornings |
| `data/brief.json` — the SCREENER brief | Claude routine | weekday mornings |
| `data/meta.json` — refresh stamp and run note | whichever ran last | — |
| `data/sources.json` — the 70 feeds | by hand | rarely |
| `data/ref.json` — reference tiles, Spotify pins | by hand | rarely |

Each file has exactly one writer, so Actions and the Claude routine never
collide even when they run minutes apart.

## Build

```sh
node src/build.mjs        # data/*.json + src/template.html -> index.html
node src/refresh-feeds.mjs # refetch all 70 feeds, rewrite data/live.json
```

`build.mjs` is pure: same inputs, byte-identical output, no network. It
validates before writing and exits non-zero on bad data, so a structurally
broken page cannot reach Pages.

Editing the page's markup, styling or rendering means editing
`src/template.html`, **not** `index.html` — `index.html` is generated and is
overwritten on every build.

## Rules the refresh obeys

These are deliberate, and worth keeping if you change the script:

- A feed that fails **keeps its previous item**. It is never blanked, and no
  placeholder is written in its place.
- Nothing is invented. No item means no change.
- If *every* feed fails, the run aborts with exit code 2 and leaves
  `data/live.json` untouched — a blocked network must not read as an empty news
  day. Actions still deploys the last good page.
- A link that just points back at the feed URL is discarded in favour of the
  previous real link.

## Setup this repo needed once

- **Settings → Pages → Source: GitHub Actions**
- The repo must be **public** for Pages on a free plan.
- Nothing else. `GITHUB_TOKEN` is provided automatically; there are no secrets
  and no API keys.
