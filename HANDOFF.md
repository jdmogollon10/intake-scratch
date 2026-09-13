# HANDOFF — state as of 13 Sep 2026

Read this first if you are a new Claude session picking up INTAKE.

## What this is

A markets dashboard, published at https://jdmogollon10.github.io/intake-scratch/
It has two halves, written by two different things:

| Half | Written by | Lands on |
| --- | --- | --- |
| News tiles (`data/live.json`) | GitHub Actions, no model | the website |
| M&A wire (`data/deals.json`) | GitHub Actions, no model | the website |
| SCREENER brief (`data/brief.json`) | nothing right now — see below | **nowhere** |

That split is the open problem. See "Pending decision" below.

There is also an older copy of the whole dashboard published as a Claude artifact:
https://claude.ai/code/artifact/b6a29efe-ff8d-47aa-bc60-ea0733c66756

## Background: why this repo exists

The dashboard used to be one hand-edited HTML file that a scheduled Claude session
rewrote each morning. That automation fired daily and silently did nothing for about
two weeks: scheduled sessions cannot reach the feed hosts, so each run hit its fetch
probe, bailed, and still reported success. The source tiles were frozen from 28 Aug
to 10 Sep while appearing to update.

The fix was to move the mechanical half onto a GitHub Actions runner, which does have
network access, and leave only the judgement half to a model.

## Status

Working and proven:
- GitHub Actions refreshes all 70 feeds daily at 11:00 UTC, rebuilds, commits, deploys.
  First successful run 10 Sep: 60/70 feeds returned an item, 55 new.
- The site deploys to GitHub Pages. Repo is public; Actions minutes are free.
- `src/build.mjs` validates before writing and is deterministic.
- `src/refresh-feeds.mjs` never blanks a failed feed, never invents an item, and
  aborts without writing if every feed fails.

- `src/refresh-deals.mjs` rebuilds the M&A wire from the deal feeds. Mechanical
  only: it drops advisory mandates, roundups and opinion pieces, never invents a
  value, and leaves industry/region blank rather than guess.

Settled by testing, not assumption:
- WebSearch DOES work in an unattended scheduled session. The 11 Sep run researched
  and wrote a full brief. It is the *delivery* that is blocked, not the research.

## Scheduled routines

| ID | What | State |
| --- | --- | --- |
| `trig_0154phNTfA1UJVMkXSvx2X6C` | SCREENER pre-market brief, 07:30 ET weekdays | on, newly fixed |
| `trig_01EYNy5XagpMUHfPByBcX95R` | SCREENER midday check, 12:30 ET weekdays | on, same fix |
| `trig_01LL3nxqQ6y4jpajKt1uviGe` | old feed refresh, 07:00 ET | **off** — Actions replaced it |
| `trig_01FgUdhxMFSKtrCkpLyc9WJ6` | "auto-refresh is dead" ping, 07:05 ET | **off** — advice obsolete |

Check them with `list_triggers`. A routine's `last_run.status: SUCCEEDED` means the
session ran, **not** that it did the work — that is exactly how the two-week silent
failure hid. Verify by looking at what actually changed on disk or on the page.

## The brief is the one thing still broken — and why

Two exits from a scheduled Claude session were tested and BOTH are closed:
- **Publishing a Claude artifact** requires a human to approve each publish. The
  11 Sep 07:30 run researched and built the page, then sat blocked on that prompt.
- **Pushing to this repo** fails: a trigger-fired session gets no repo credentials.
  Verified twice — a 17-minute brief run and a 1-minute push-only test both landed
  nothing in the repo.

The unlock is a `GITHUB_TOKEN` environment variable on the environment the routine
fires in (fine-grained PAT, Contents: Read and write on this repo). The routine
`INTAKE — morning build` (trig_01FeSAcqNF7usb8iaN7att1M) already tries `$GITHUB_TOKEN`
first, so it starts working the moment that variable exists. Nothing needs rebuilding.

## If you are picking this up

The only missing piece is `data/brief.json`. Everything else refreshes daily on its
own. Do not rebuild the pipeline — check whether `GITHUB_TOKEN` now exists in the
routine's environment, then fire `trig_01FeSAcqNF7usb8iaN7att1M` and watch the repo
for a commit. That is the whole test.

If a token is never going to be available, the fallback is generating the brief inside
the Actions workflow with an Anthropic API key in repo secrets — costs a few cents a
day and removes scheduled Claude sessions from the picture entirely.

The account has **no GitHub connector** (only Google Calendar and Google Drive), so
"attach GitHub to the routine" is not available — that was checked, not assumed.

## Environment gotchas for a Claude session working on this

These cost real time to rediscover:

- Feed hosts and `*.github.io` are refused by the egress proxy (403 on CONNECT) for
  both `curl` and WebFetch. **WebSearch is not blocked** and is how the 10 Sep brief
  was researched. Do not conclude the site is broken because you cannot load it.
- `curl -o file` fails to write in this sandbox. Use shell redirection instead.
- `api.github.com` works, but its `/pages` and `/environments` paths are proxy-blocked.
  Check-run annotations are readable and carry real error text — that is how the Pages
  deployment failure was diagnosed.
- The default branch is `claude/quirky-davinci-fhvy4c`, not `main`. Scheduled workflows
  only run on the default branch. The `github-pages` environment previously rejected
  this branch until its deployment-branch rule was relaxed.

## Editing

Edit `src/template.html` for markup/styling/rendering — **not** `index.html`, which is
generated and overwritten on every build. See README.md for the file layout and the
rules the refresh obeys.
