#!/usr/bin/env node
// Fleet health check for FreeGameStore.
//
// A platform of N independent game repos under a "vendor, don't copy" model has
// no built-in way to answer "is the catalog healthy?". This probes every game in
// the registry for the failure modes that have silently taken the fleet down:
//
//   1. Lockfile drift   — pnpm-lock.yaml out of sync with web/package.json
//                         (the bug that froze ~42 games' deploys for ~2 weeks).
//   2. CI red           — latest GitHub Actions run failed → not deploying.
//   3. Down             — <id>.freegamestore.online not serving 200.
//   4. Registry drift   — org game-repo with no registry entry, or registry
//                         entry whose repo is gone (CF 1014 territory).
//
// Read-only. Needs a GitHub token with `repo` read on the org:
//   GH_TOKEN=<token> node scripts/fleet-health.mjs            # human report
//   GH_TOKEN=<token> node scripts/fleet-health.mjs --json     # machine output
//   GH_TOKEN=<token> node scripts/fleet-health.mjs --strict   # exit 1 if unhealthy
//
// Exit code: 0 healthy, 1 if any game is unhealthy (with --strict; always for CI).

const ORG = process.env.FGS_ORG || 'freegamestore-online';
const STORE_REPO = process.env.FGS_STORE_REPO || 'freegamestore';
const DOMAIN = 'freegamestore.online';
const SDK = '@freegamestore/games';
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const JSON_OUT = process.argv.includes('--json');
const STRICT = process.argv.includes('--strict') || !!process.env.CI;
const CONCURRENCY = 6;

if (!TOKEN) {
  console.error(`error: set GH_TOKEN (a GitHub token with repo read on ${ORG})`);
  process.exit(2);
}

const GH = 'https://api.github.com';
const headers = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'fgs-fleet-health',
  'X-GitHub-Api-Version': '2022-11-28',
};

async function gh(path) {
  const res = await fetch(path.startsWith('http') ? path : `${GH}${path}`, { headers });
  if (res.status === 404) return { __status: 404 };
  if (!res.ok) return { __status: res.status, __error: await res.text().catch(() => '') };
  return res.json();
}

const decode = (b64) => Buffer.from(b64, 'base64').toString('utf8');

/** @freegamestore/games specifier from web/package.json (or null). */
async function pkgSpec(repo) {
  const f = await gh(`/repos/${ORG}/${repo}/contents/web/package.json`);
  if (!f?.content) return null;
  try {
    const pkg = JSON.parse(decode(f.content));
    return pkg.dependencies?.[SDK] || pkg.devDependencies?.[SDK] || null;
  } catch {
    return null;
  }
}

/** @freegamestore/games specifier recorded in pnpm-lock.yaml (or null). */
async function lockSpec(repo) {
  const f = await gh(`/repos/${ORG}/${repo}/contents/pnpm-lock.yaml`);
  if (!f?.content) return null;
  const lock = decode(f.content);
  // importer entry:  '@freegamestore/games':\n  specifier: ^0.14.0
  const re = new RegExp(`'${SDK.replace(/[/]/g, '\\/')}':\\s*\\n\\s*specifier:\\s*([^\\n]+)`);
  const m = lock.match(re);
  return m ? m[1].trim() : null;
}

/** Latest workflow-run conclusion + whether a deploy run is failing. */
async function ciStatus(repo) {
  const data = await gh(`/repos/${ORG}/${repo}/actions/runs?per_page=10`);
  const runs = data?.workflow_runs || [];
  if (runs.length === 0) return { latest: 'none', deploy: 'none' };
  const latest = runs[0];
  const deploy = runs.find((r) => /deploy/i.test(r.name));
  return {
    latest: latest.conclusion || latest.status,
    deploy: deploy ? deploy.conclusion || deploy.status : 'none',
  };
}

/** Is <id>.freegamestore.online serving? */
async function live(id) {
  try {
    const res = await fetch(`https://${id}.${DOMAIN}/`, {
      method: 'HEAD',
      headers: { 'User-Agent': 'fgs-fleet-health' },
      signal: AbortSignal.timeout(10000),
    });
    return res.status;
  } catch {
    return 0;
  }
}

async function checkGame(id) {
  const repo = await gh(`/repos/${ORG}/${id}`);
  if (repo.__status === 404) return { id, issues: ['repo-missing'], detail: {} };
  const [pkg, lock, ci, status] = await Promise.all([
    pkgSpec(id),
    lockSpec(id),
    ciStatus(id),
    live(id),
  ]);
  const issues = [];
  if (pkg && lock && pkg !== lock) issues.push('lockfile-drift');
  if (pkg && !lock) issues.push('lockfile-missing-sdk');
  if (ci.deploy === 'failure' || (ci.deploy === 'none' && ci.latest === 'failure'))
    issues.push('ci-red');
  if (status !== 200) issues.push('down');
  return { id, issues, detail: { pkg, lock, ci, status, archived: repo.archived } };
}

async function mapLimit(items, limit, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

async function main() {
  // Catalog of record.
  const reg = await gh(`/repos/${ORG}/${STORE_REPO}/contents/registry.json`);
  if (!reg?.content) {
    console.error('error: could not read registry.json');
    process.exit(2);
  }
  const registry = JSON.parse(decode(reg.content));
  const games = (registry.games || []).filter((g) => g.id);
  const ids = games.map((g) => g.id);

  const results = (await mapLimit(ids, CONCURRENCY, checkGame))
    .filter((r) => r.issues.length > 0)
    .filter((r) => !r.detail.archived); // archived games are intentionally retired

  if (JSON_OUT) {
    console.log(JSON.stringify({ checked: ids.length, unhealthy: results }, null, 2));
  } else {
    console.log(`\nFleet health — ${ORG} (${ids.length} games in registry)\n${'='.repeat(48)}`);
    if (results.length === 0) {
      console.log('✅ all games healthy (no drift, CI green, serving 200)\n');
    } else {
      const byIssue = {};
      for (const r of results) for (const iss of r.issues) (byIssue[iss] ||= []).push(r);
      const labels = {
        'lockfile-drift': '🔴 Lockfile drift (will fail CI install → no deploy)',
        'lockfile-missing-sdk': '🟠 Lockfile missing the SDK entry',
        'ci-red': '🔴 CI red (latest deploy run failed)',
        down: '🟠 Down (subdomain not serving 200)',
        'repo-missing': '🔴 Registry entry but repo missing (1014 drift)',
      };
      for (const [iss, list] of Object.entries(byIssue)) {
        console.log(`\n${labels[iss] || iss} — ${list.length}`);
        for (const r of list) {
          const d = r.detail;
          let extra = '';
          if (iss === 'lockfile-drift') extra = `  (pkg ${d.pkg} vs lock ${d.lock})`;
          if (iss === 'down') extra = `  (HTTP ${d.status})`;
          console.log(`  - ${r.id}${extra}`);
        }
      }
      console.log(
        `\n${results.length} unhealthy of ${ids.length}. Full repo: https://github.com/${ORG}/<id>\n`,
      );
    }
  }

  if (STRICT && results.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error('fleet-health failed:', e);
  process.exit(2);
});
