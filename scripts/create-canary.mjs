#!/usr/bin/env node
// Create canary for FreeGameStore (#527).
//
// Creates a throwaway game through one creation path, asserts that it ended in a
// supported state, then removes it. "Created" is not enough: the registry entry,
// the host route, the generated deploy.yml and the first keyless deploy all have
// to be right (#520).
//
//   FGS_SESSION_TOKEN=<canary session> GH_TOKEN=<repo read> \
//     node scripts/create-canary.mjs [--path console|mcp] [--keep]
//
// The session is the keyless one from scripts/canary-session.mjs (#531): a
// 15-minute fgs_token for the sub `canary:freegamestore-online/platform`, good
// for creating and deleting `e2e-create-*-test` games and nothing else.
//
// Paths:
//   console  POST console /api/create, DELETE console /api/games/:id  (cookie session, as the browser does)
//   mcp      MCP create_game / delete_game over streamable HTTP        (Bearer FGS_SESSION_TOKEN)
// Both funnel into admin `handlePublish`; the CLI and VibeCode paths do too (see #527).
//
// Cleanup delists the game, drops the route and archives the repo, and runs even
// when an assertion fails. It then reads the repo back: one that exists and is
// not archived fails the run, loudly. The create can outlive the 15-minute
// session (the first deploy is awaited), so cleanup takes a fresh one.
// Needs packages/compliance built (pnpm --filter @freegamestore/compliance build).

import { pathToFileURL } from 'node:url';
import { exchangeCanarySession } from './canary-session.mjs';

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

const NAME = 'E2E Create Canary';
const CALL_TIMEOUT_MS = 150_000;

const short = (v) => String(v ?? '').slice(0, 300);

/** One MCP JSON-RPC call over streamable HTTP. The answer is JSON or an SSE stream. */
async function mcpCall(doFetch, token, sessionId, id, method, params) {
  const res = await doFetch(`https://mcp.${DOMAIN}/mcp`, {
    method: 'POST',
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', ...(id === undefined ? {} : { id }), method, params }),
  });
  const text = await res.text();
  let message = null;
  if (text.trim()) {
    const payloads = /^\s*[{[]/.test(text)
      ? [text]
      : text
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim());
    for (const payload of payloads) {
      try {
        const parsed = JSON.parse(payload);
        if (id === undefined || parsed.id === id) message = parsed;
      } catch {
        /* a keep-alive or partial frame */
      }
    }
  }
  return { res, message, sessionId: res.headers.get('mcp-session-id') ?? sessionId };
}

/** Call one MCP tool in a fresh session. `{ok, text}`; ok is false for HTTP and tool errors. */
export async function mcpTool(doFetch, token, name, args) {
  const init = await mcpCall(doFetch, token, null, 1, 'initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'fgs-create-canary', version: '1' },
  });
  if (!init.res.ok || !init.message?.result)
    return { ok: false, text: `MCP initialize failed: HTTP ${init.res.status}` };
  await mcpCall(doFetch, token, init.sessionId, undefined, 'notifications/initialized', {});
  const call = await mcpCall(doFetch, token, init.sessionId, 2, 'tools/call', {
    name,
    arguments: args,
  });
  if (!call.res.ok) return { ok: false, text: `MCP ${name} failed: HTTP ${call.res.status}` };
  if (call.message?.error)
    return { ok: false, text: `MCP ${name}: ${short(call.message.error.message)}` };
  const text = (call.message?.result?.content ?? []).map((c) => c.text ?? '').join('\n');
  return { ok: !call.message?.result?.isError && !!call.message?.result, text: short(text) };
}

const consoleHeaders = (token) => ({
  'Content-Type': 'application/json',
  Origin: `https://console.${DOMAIN}`,
  Cookie: `__Host-fgs_token=${token}`,
});

/** Create `id` through `path`. `{ok, detail}`. */
export async function createGame(path, id, token, doFetch = fetch) {
  if (path === 'mcp') {
    const r = await mcpTool(doFetch, token, 'create_game', {
      game_id: id,
      name: NAME,
      category: 'arcade',
      template: 'canvas',
    });
    return { ok: r.ok, detail: r.ok ? '' : `create via mcp failed: ${r.text}` };
  }
  const res = await doFetch(`https://console.${DOMAIN}/api/create`, {
    method: 'POST',
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    headers: consoleHeaders(token),
    body: JSON.stringify({
      id,
      name: NAME,
      category: 'arcade',
      description: 'canary',
      template: 'canvas',
    }),
  });
  if (res.ok) return { ok: true, detail: '' };
  const body = await res.json().catch(() => ({}));
  return {
    ok: false,
    detail: `create via console failed: HTTP ${res.status}${body.error ? ` (${short(body.error)})` : ''}`,
  };
}

/** Delist, drop the route and archive `id`. `{ok, notFound, detail}`. */
export async function deleteGame(path, id, token, doFetch = fetch) {
  if (path === 'mcp') {
    const r = await mcpTool(doFetch, token, 'delete_game', { game_id: id, confirm: id });
    return { ok: r.ok, notFound: !r.ok && /not found/i.test(r.text), detail: r.text };
  }
  const res = await doFetch(`https://console.${DOMAIN}/api/games/${id}`, {
    method: 'DELETE',
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    headers: consoleHeaders(token),
  });
  const body = await res.json().catch(() => ({}));
  const failedSteps = (body.steps ?? []).filter((s) => s.status === 'fail');
  return {
    ok: res.ok && !body.error && failedSteps.length === 0,
    notFound: res.status === 404,
    detail: `HTTP ${res.status}${body.error ? ` (${short(body.error)})` : ''}${failedSteps.map((s) => ` ${s.name}: ${short(s.detail)}`).join('')}`,
  };
}

/** Run one canary: create, assert, clean up. Returns the failures (empty = pass).
 *  `deps`: id, token, freshSession(), ghToken, expectedWorkflow, keep; fetch and
 *  the end-state options are injectable for tests. */
export async function runCanary(path, deps) {
  const { id, token, freshSession, ghToken, expectedWorkflow, keep = false } = deps;
  const doFetch = deps.fetch ?? fetch;
  const failures = [];
  try {
    const created = await createGame(path, id, token, doFetch);
    if (!created.ok) failures.push(created.detail);
    else
      failures.push(
        ...(await checkEndState(id, {
          ...deps.endState,
          ghToken,
          expectedWorkflow,
          fetch: doFetch,
        })),
      );
  } catch (e) {
    failures.push(`canary stopped early: ${short(e?.message ?? e)}`);
  } finally {
    if (!keep) {
      try {
        const removed = await deleteGame(path, id, await freshSession(), doFetch);
        if (!removed.ok && !removed.notFound)
          failures.push(`cleanup of ${id} failed: ${removed.detail}`);
      } catch (e) {
        failures.push(`cleanup of ${id} failed: ${short(e?.message ?? e)}`);
      }
      // Whatever happened above, a repo that exists must end archived.
      try {
        const repo = await doFetch(`${GH}/repos/${ORG}/${id}`, {
          headers: {
            Authorization: `Bearer ${ghToken}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'fgs-create-canary',
          },
        });
        if (repo.ok && (await repo.json()).archived !== true)
          failures.push(`${ORG}/${id} exists and is NOT archived: archive it by hand`);
        else if (!repo.ok && repo.status !== 404)
          failures.push(`could not confirm ${ORG}/${id} is archived (HTTP ${repo.status})`);
      } catch (e) {
        failures.push(`could not confirm ${ORG}/${id} is archived: ${short(e?.message ?? e)}`);
      }
    }
  }
  return failures;
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
  const failures = await runCanary(path, {
    id,
    token,
    ghToken,
    expectedWorkflow: GAME_DEPLOY_WORKFLOW,
    keep: args.includes('--keep'),
    // The session lasts 15 minutes and the first deploy is awaited, so cleanup
    // exchanges again when it can (inside the workflow); locally it reuses the token.
    freshSession: () =>
      process.env.ACTIONS_ID_TOKEN_REQUEST_URL ? exchangeCanarySession() : Promise.resolve(token),
  });
  if (failures.length) {
    console.error(`create canary (${path}) FAILED for ${id}:\n- ${failures.join('\n- ')}`);
    process.exit(1);
  }
  console.log(`create canary (${path}) ok: ${id}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
