#!/usr/bin/env node
/* Commit files to GitHub through the REST API instead of `git push`.

   WHY THIS EXISTS
   Scheduled Claude sessions get no git credentials, so `git push` fails with a 403.
   They can, however, be given a stored API credential, which the environment's proxy
   attaches to outgoing requests to api.github.com as an Authorization header. Git
   itself will not use that header, but the REST API will — so the morning job writes
   its commit this way.

   This script NEVER sees or handles the token. It sends plain requests and lets the
   proxy authenticate them. Do not add an Authorization header here.

   Usage:  node src/commit-via-api.mjs "commit message" data/brief.json [more files...]

   Uses the Git Data API rather than the simpler contents endpoint so that several
   files land in ONE commit rather than one commit each. */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OWNER = "jdmogollon10";
const REPO = "intake-scratch";
const BRANCH = "claude/quirky-davinci-fhvy4c";
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;

const [message, ...files] = process.argv.slice(2);
if (!message || !files.length) {
  console.error('usage: node src/commit-via-api.mjs "message" <file> [file...]');
  process.exit(64);
}

async function gh(path, method = "GET", body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "intake-bot",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    // Distinguish the two very different 403s, because they need opposite fixes.
    let hint = "";
    if (/rate limit/i.test(text)) {
      hint =
        "\n  -> RATE LIMITED, not an auth problem. The request went out with no credential" +
        "\n     attached, so GitHub counted it against the shared anonymous pool.";
    } else if (res.status === 401 || res.status === 403) {
      hint =
        "\n  -> the environment's GitHub API credential is missing, expired, or lacks" +
        "\n     Contents: Read and write on this repository";
    }
    throw new Error(`${method} ${path} -> HTTP ${res.status}\n  ${text.slice(0, 300)}${hint}`);
  }
  return text ? JSON.parse(text) : null;
}

/* 1. where the branch currently points */
const ref = await gh(`/git/ref/heads/${BRANCH}`);
const parent = ref.object.sha;
const baseCommit = await gh(`/git/commits/${parent}`);

/* 2. upload each file as a blob */
const tree = [];
for (const f of files) {
  const rel = relative(ROOT, join(ROOT, f)).replace(/\\/g, "/");
  const content = readFileSync(join(ROOT, f), "utf8");
  const blob = await gh("/git/blobs", "POST", { content, encoding: "utf-8" });
  tree.push({ path: rel, mode: "100644", type: "blob", sha: blob.sha });
  console.log(`  staged ${rel} (${content.length} bytes)`);
}

/* 3. a tree on top of the current one, 4. a commit, 5. move the branch */
const newTree = await gh("/git/trees", "POST", { base_tree: baseCommit.tree.sha, tree });
const commit = await gh("/git/commits", "POST", {
  message,
  tree: newTree.sha,
  parents: [parent],
});
await gh(`/git/refs/heads/${BRANCH}`, "PATCH", { sha: commit.sha, force: false });

console.log(`committed ${commit.sha.slice(0, 7)} to ${BRANCH} — ${files.length} file(s)`);
console.log("GitHub Actions will rebuild and redeploy the site from this commit.");
