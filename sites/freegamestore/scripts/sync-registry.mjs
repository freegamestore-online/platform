#!/usr/bin/env node
// Refresh each game's `lastUpdated` in registry.json from its GitHub repo's last
// push time (#417). Run weekly by .github/workflows/registry-sync.yml, which
// commits the result straight to main (no PR) → auto-deploys the storefront.
//
// Scope / guardrails:
//   - Only `lastUpdated` is touched. Nothing else in registry.json is changed.
//   - Minimal diff: writes JSON.stringify(…, 2) with no trailing newline, which
//     is exactly the file's existing shape.
//   - `status` is NEVER changed here — flipping it could hide a live game. Repos
//     that are missing / private / unreachable are reported for human review,
//     not acted on.
//
// Usage: node scripts/sync-registry.mjs [--dry-run]
//   Needs `gh` authenticated (GH_TOKEN) to read repo metadata.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DRY_RUN = process.argv.includes("--dry-run");
const REGISTRY = fileURLToPath(new URL("../registry.json", import.meta.url));

function ghRepo(repo) {
  // Returns the parsed repos/{owner}/{name} payload, or null if unreachable.
  try {
    const out = execFileSync("gh", ["api", `repos/${repo}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(out);
  } catch {
    return null;
  }
}

const raw = readFileSync(REGISTRY, "utf8");
const data = JSON.parse(raw);
const games = data.games;

let updated = 0;
let unchanged = 0;
const anomalies = [];

for (const g of games) {
  if (!g.repo) {
    anomalies.push(`${g.id}: no repo in registry`);
    continue;
  }
  const info = ghRepo(g.repo);
  if (!info || !info.pushed_at) {
    anomalies.push(`${g.id}: repo ${g.repo} unreachable (missing, private or renamed)`);
    continue;
  }
  if (info.archived) anomalies.push(`${g.id}: repo ${g.repo} is archived`);
  const next = info.pushed_at; // ISO 8601, e.g. 2026-09-13T04:36:39Z
  if (g.lastUpdated === next) {
    unchanged++;
  } else {
    g.lastUpdated = next;
    updated++;
  }
}

// Match the file's existing shape exactly: 2-space indent, no trailing newline.
const out = JSON.stringify(data, null, 2);
const changed = out !== raw;
if (changed && !DRY_RUN) writeFileSync(REGISTRY, out);

const summary = [
  `Registry sync: ${updated} lastUpdated changed, ${unchanged} unchanged, ${games.length} games.`,
  anomalies.length ? `\nAnomalies (not acted on — review):\n- ${anomalies.join("\n- ")}` : "\nNo anomalies.",
  DRY_RUN ? "\n(dry run — registry.json not written)" : changed ? "" : "\nregistry.json unchanged.",
].join("");
console.log(summary);

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Registry sync\n\n${summary}\n`);
}
