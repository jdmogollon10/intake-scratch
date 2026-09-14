# HANDOFF — state as of 14 Sep 2026

Everything works and refreshes on its own. Read this before changing anything.

Live site: https://jdmogollon10.github.io/intake-scratch/

## Who writes what

| Part | Written by | When |
| --- | --- | --- |
| News tiles (`data/live.json`) | GitHub Actions, no model | daily, 11:00 UTC |
| M&A wire (`data/deals.json`) | GitHub Actions, no model | same run |
| SCREENER brief (`data/brief.json`) | a Claude Routine | weekday mornings |
| `index.html` + Pages deploy | GitHub Actions | on every data change |

Each file has exactly one writer, so nothing collides. The Actions half needs no
model, no key and no account — it is plain scripts on GitHub's runners.

## The one thing that took a week to find

A Claude Routine can only write to this repo **if the repository is attached to the
routine itself**. That attachment is available in the claude.ai Routines UI (the
repo chip under the Instructions box) and is NOT settable through the trigger API.
A routine without it can research perfectly well and then has no way to deliver.

Everything else was a dead end, each verified rather than assumed:

- **Publishing a Claude artifact** from a scheduled session needs a human to approve
  every publish. A run on 11 Sep researched, wrote a full brief, and sat blocked on
  that prompt until it was abandoned.
- **`git push` from a trigger-spawned session** fails: no credentials. Verified twice,
  including with a one-minute push-only test that did nothing but try.
- **GitHub's REST API** is refused by the environment's own proxy — *"Write access to
  this GitHub API path is not permitted through this proxy"* — no matter whose token
  is attached. Reads work; writes do not. Tested on two different write endpoints.
- A stored **API credential** on the environment authenticates reads (GitHub sees the
  account, 15k/hr limit) but does not lift that write block.

`src/commit-via-api.mjs` was written for the API route before it was found to be
blocked. It is kept because it is correct and may work from somewhere less restricted,
but nothing currently uses it.

## If the brief stops appearing

Check `data/brief.json` — not the routine's status. A routine reporting SUCCEEDED
means the session ran, **not** that it did the work. That is exactly how an earlier
version failed silently for two weeks while looking healthy.

Then check, in order: is the routine still enabled; is the repository still attached
to it; did its session get blocked on something.

## Environment gotchas

Rediscovering these costs hours:

- Feed hosts and `*.github.io` are refused by the egress proxy (403 on CONNECT) for
  both `curl` and WebFetch. **WebSearch is not blocked** and is how every brief has
  been researched. Never conclude the site is down because you cannot load it.
- `curl -o file` cannot write in the sandbox — use shell redirection.
- `api.github.com` reads fine; `/pages` and `/environments` are proxy-blocked. Check-run
  annotations ARE readable and carry real error text — that is how the Pages deployment
  failure was diagnosed.
- The default branch is `claude/quirky-davinci-fhvy4c`, not `main`. Scheduled workflows
  only run on the default branch, and the `github-pages` environment rejected this
  branch until its deployment-branch rule was relaxed.
- GitHub's cron is best-effort: the 11:00 UTC job has landed as late as 14:45 UTC.
  Late is normal; missing is not.

## The browser-tab logo

`favicon.png` at the repo root is the tab icon. `src/build.mjs` looks for
`assets/favicon.*` first, then `favicon.*` at the root, and falls back to a 🗞️ emoji
if neither exists — so deleting the file is a safe way to undo. To swap the logo,
upload a replacement under the same name.

The workflow's `push` path filter must keep listing `favicon.*` and `assets/**`.
It did not at first, and the result is quietly confusing: the upload commits fine,
no workflow runs, and the page goes on pointing at the old icon.

## Editing

Edit `src/template.html` for markup, styling and rendering — **never** `index.html`,
which is generated and overwritten on every build. `src/build.mjs` validates the data
and exits non-zero rather than publish a broken page. See README.md for the layout and
the rules the refreshers obey.
