#!/usr/bin/env node
// Create canary for FreeGameStore (#527).
//
// Creates a throwaway game through one creation path, asserts that it ended in a
// supported state, then removes it. "Created" is not enough: the registry entry,
// the host route, the generated deploy.yml and the first keyless deploy all have
// to be right (#520).
//
//   FGS_SESSION_TOKEN=<creator session> GH_TOKEN=<repo read> \
//     node scripts/create-canary.mjs [--path console|mcp] [--keep]
//
// Paths:
//   console  POST console /api/create        (cookie session, as the browser does)
//   mcp      POST mcp /mcp tools/call create_game (Bearer FGS_SESSION_TOKEN)
// Both funnel into admin `handlePublish`; the CLI and VibeCode paths do too (see #527).
//
// Cleanup is DELETE admin /api/games/:id, which delists, drops the route and
// archives the repo: nothing is left un-archived, even when an assertion fails.
// Needs packages/compliance built (pnpm --filter @freegamestore/compliance build).

import { pathToFileURL } from 'node:url';

const ORG = 'freegamestore-online';
const DOMAIN = 'freegamestore.online';
const REGISTRY_PATH = 'sites/freegamestore/registry.json';
const GH = 'https://api.github.com';

/** Assert a created game's end state. Returns the list of failures (empty = pass).
 *  `deps.fetch` and `deps.sleep` are injectable for tests. */
export async function checkEndState(id, deps) {
  const { ghToken, expectedWorkflow, runTimeoutMs = 15 * 60_000, pollMs = 15_000 } = deps;
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const gh = (path, accept = 'application/vnd.github+json') =>
    doFetch(`${GH}${path}`, {
      headers: {
        Authorization: `Bearer ${ghToken}`,
        Accept: accept,
        'User-Agent': 'fgs-create-canary',
      },
    });
  const failures = [];

  // 1. Registry entry points at the new repo.
  const reg = await gh(
    `/repos/${ORG}/platform/contents/${REGISTRY_PATH}`,
    'application/vnd.github.raw+json',
  );
  if (!reg.ok) failures.push(`registry unreadable (HTTP ${reg.status})`);
  else {
    const entry = ((await reg.json()).games ?? []).find((g) => g.id === id);
    if (!entry) failures.push('no registry entry');
    else if (entry.repo !== `${ORG}/${id}`)
      failures.push(`registry repo is ${entry.repo}, want ${ORG}/${id}`);
  }

  // 2. Host route: an unrouted host answers "no game registered".
  const host = await doFetch(`https://${id}.${DOMAIN}/`);
  const hostBody = await host.text();
  if (/no game registered/i.test(hostBody))
    failures.push('no host route (host answers "no game registered")');

  // 3. deploy.yml is exactly the supported keyless caller.
  const wf = await gh(
    `/repos/${ORG}/${id}/contents/.github/workflows/deploy.yml`,
    'application/vnd.github.raw+json',
  );
  if (!wf.ok) failures.push(`deploy.yml unreadable (HTTP ${wf.status})`);
  else if ((await wf.text()) !== expectedWorkflow)
    failures.push('deploy.yml is not the supported GAME_DEPLOY_WORKFLOW');

  // 4. The first push-triggered deploy run concludes success (no 403 "not a provisioned game").
  let conclusion = null;
  for (const start = Date.now(); Date.now() - start < runTimeoutMs; ) {
    const runs = await gh(
      `/repos/${ORG}/${id}/actions/workflows/deploy.yml/runs?event=push&per_page=20`,
    );
    if (runs.ok) {
      const list = ((await runs.json()).workflow_runs ?? []).filter(
        (r) => r.status === 'completed' && r.conclusion !== 'cancelled',
      );
      // Oldest completed push run = the first one the provision triggered.
      const first = list.at(-1);
      if (first) {
        conclusion = first.conclusion;
        break;
      }
    }
    await sleep(pollMs);
  }
  if (conclusion === null) failures.push('first deploy run did not finish in time');
  else if (conclusion !== 'success') failures.push(`first deploy run concluded ${conclusion}`);

  return failures;
}

async function createViaConsole(id, token) {
  return fetch(`https://console.${DOMAIN}/api/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: `https://console.${DOMAIN}`,
      Cookie: `__Host-fgs_token=${token}`,
    },
    body: JSON.stringify({
      id,
      name: 'E2E Create Canary',
      category: 'arcade',
      description: 'canary',
      template: 'canvas',
    }),
  });
}

async function createViaMcp(id, token) {
  return fetch(`https://mcp.${DOMAIN}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'create_game',
        arguments: {
          game_id: id,
          name: 'E2E Create Canary',
          category: 'arcade',
          template: 'canvas',
        },
      },
    }),
  });
}

async function main() {
  const args = process.argv.slice(2);
  const path = args.includes('--path') ? args[args.indexOf('--path') + 1] : 'console';
  const token = process.env.FGS_SESSION_TOKEN;
  const ghToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token || !ghToken || !['console', 'mcp'].includes(path)) {
    console.error(
      'usage: FGS_SESSION_TOKEN=... GH_TOKEN=... node scripts/create-canary.mjs [--path console|mcp] [--keep]',
    );
    process.exit(2);
  }
  const { GAME_DEPLOY_WORKFLOW } = await import('../packages/compliance/dist/index.js');
  const id = `e2e-create-${path}-${Date.now().toString(36)}-test`;
  let failures = [];
  try {
    const res = await (path === 'mcp' ? createViaMcp : createViaConsole)(id, token);
    if (!res.ok) failures.push(`create via ${path} failed: HTTP ${res.status}`);
    else failures = await checkEndState(id, { ghToken, expectedWorkflow: GAME_DEPLOY_WORKFLOW });
  } finally {
    if (!args.includes('--keep')) {
      const del = await fetch(`https://admin.${DOMAIN}/api/games/${id}`, {
        method: 'DELETE',
        headers: { 'X-FGS-Token': token },
      });
      if (!del.ok && del.status !== 404)
        failures.push(`cleanup of ${id} failed: HTTP ${del.status} (archive it by hand)`);
    }
  }
  if (failures.length) {
    console.error(`create canary (${path}) FAILED for ${id}:\n- ${failures.join('\n- ')}`);
    process.exit(1);
  }
  console.log(`create canary (${path}) ok: ${id}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
