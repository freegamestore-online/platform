import assert from 'node:assert/strict';
import test from 'node:test';
import { checkEndState, createGame, deleteGame, runCanary } from './create-canary.mjs';

const WF = 'name: CI / Deploy\n';

function deps({
  registry,
  hostBody = '<html>',
  workflow = WF,
  runs = [{ status: 'completed', conclusion: 'success' }],
}) {
  return {
    ghToken: 't',
    expectedWorkflow: WF,
    pollMs: 0,
    runTimeoutMs: 20,
    sleep: async () => {},
    fetch: async (input) => {
      const url = String(input);
      if (url.includes('/contents/sites/')) return Response.json({ games: registry });
      if (url.includes('/contents/.github/workflows/deploy.yml')) return new Response(workflow);
      if (url.includes('/actions/workflows/deploy.yml/runs'))
        return Response.json({ workflow_runs: runs });
      return new Response(hostBody);
    },
  };
}
const good = [{ id: 'g', repo: 'freegamestore-online/g' }];

test('a fully correct game has no failures', async () => {
  assert.deepEqual(await checkEndState('g', deps({ registry: good })), []);
});

test('reports a missing registry entry, a wrong repo, a missing route and a legacy workflow', async () => {
  assert.deepEqual(await checkEndState('g', deps({ registry: [] })), ['no registry entry']);
  const wrong = await checkEndState('g', deps({ registry: [{ id: 'g', repo: 'x/y' }] }));
  assert.match(wrong[0], /registry repo is x\/y/);
  const noRoute = await checkEndState(
    'g',
    deps({ registry: good, hostBody: 'Not Found: no game registered' }),
  );
  assert.match(noRoute[0], /no host route/);
  const legacy = await checkEndState('g', deps({ registry: good, workflow: 'aws s3 sync' }));
  assert.match(legacy[0], /not the supported/);
});

test('fails when the first deploy run is red or never finishes; ignores cancelled runs', async () => {
  const red = await checkEndState(
    'g',
    deps({ registry: good, runs: [{ status: 'completed', conclusion: 'failure' }] }),
  );
  assert.deepEqual(red, ['first deploy run concluded failure']);
  const none = await checkEndState(
    'g',
    deps({ registry: good, runs: [{ status: 'completed', conclusion: 'cancelled' }] }),
  );
  assert.deepEqual(none, ['first deploy run did not finish in time']);
});

// --- the run: create, assert, clean up (#531) ---

/** A fake of everything the canary talks to. `state` records what happened. */
function world(opts = {}) {
  const state = { created: false, deleted: false, archived: false, calls: [] };
  const mcp = (body) => {
    if (body.method === 'initialize')
      return Response.json(
        { jsonrpc: '2.0', id: 1, result: {} },
        { headers: { 'mcp-session-id': 's1' } },
      );
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
    const { name, arguments: a } = body.params;
    state.calls.push(`mcp ${name} ${a.game_id}`);
    const result = (text, isError = false) =>
      new Response(
        `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text }], isError } })}\n\n`,
        { headers: { 'Content-Type': 'text/event-stream' } },
      );
    if (name === 'create_game') {
      if (opts.createFails) return result('Provision failed: boom', true);
      state.created = true;
      return result('Created');
    }
    if (!state.created) return result('Could not delete: Game not found in registry', true);
    if (opts.deleteFails) return result('cleanup was incomplete', true);
    state.deleted = state.archived = !opts.archiveSilentlyFails;
    return result('Deleted');
  };
  const fetch = async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    if (url === 'https://mcp.freegamestore.online/mcp') return mcp(JSON.parse(init.body));
    if (url.endsWith('/api/create')) {
      state.calls.push('console create');
      if (opts.createFails) return Response.json({ error: 'nope' }, { status: 500 });
      state.created = true;
      return Response.json({ success: true });
    }
    if (method === 'DELETE' && url.includes('/api/games/')) {
      state.calls.push('console delete');
      if (!state.created) return Response.json({ error: 'not found' }, { status: 404 });
      if (opts.deleteFails) return Response.json({ error: 'x' }, { status: 500 });
      state.deleted = state.archived = !opts.archiveSilentlyFails;
      return Response.json({ ok: true, steps: [] });
    }
    if (url.match(/\/repos\/freegamestore-online\/e2e-[^/]*$/)) {
      if (!state.created) return new Response('{}', { status: 404 });
      return Response.json({ archived: state.archived });
    }
    if (url.includes('/contents/sites/'))
      return Response.json({ games: [{ id: opts.id, repo: `freegamestore-online/${opts.id}` }] });
    if (url.includes('/contents/.github/workflows/deploy.yml')) return new Response(WF);
    if (url.includes('/actions/workflows/deploy.yml/runs'))
      return Response.json({
        workflow_runs: [{ status: 'completed', conclusion: opts.deploy ?? 'success' }],
      });
    return new Response('<html>');
  };
  return { state, fetch };
}

const ID = 'e2e-create-console-abc-test';
function run(path, opts = {}) {
  const w = world({ id: ID, ...opts });
  const sessions = [];
  return {
    w,
    sessions,
    done: runCanary(path, {
      id: ID,
      token: 'first',
      freshSession: async () => {
        sessions.push('fresh');
        return 'second';
      },
      ghToken: 't',
      expectedWorkflow: WF,
      fetch: w.fetch,
      endState: { pollMs: 0, runTimeoutMs: 20, sleep: async () => {} },
    }),
  };
}

for (const path of ['console', 'mcp']) {
  test(`${path}: a good run creates, asserts, then deletes with a fresh session and ends archived`, async () => {
    const r = run(path);
    assert.deepEqual(await r.done, []);
    assert.equal(r.w.state.created && r.w.state.deleted && r.w.state.archived, true);
    assert.deepEqual(r.sessions, ['fresh']);
  });

  test(`${path}: a failed assertion still cleans up, and the run is red`, async () => {
    const r = run(path, { deploy: 'failure' });
    const failures = await r.done;
    assert.deepEqual(failures, ['first deploy run concluded failure']);
    assert.equal(r.w.state.archived, true);
  });

  test(`${path}: a failed create is reported, and cleanup finding nothing is fine`, async () => {
    const r = run(path, { createFails: true });
    const failures = await r.done;
    assert.equal(failures.length, 1);
    assert.match(failures[0], new RegExp(`create via ${path} failed`));
  });

  test(`${path}: a cleanup that fails, or leaves the repo un-archived, is loud`, async () => {
    const failed = await run(path, { deleteFails: true }).done;
    assert.match(failed.join('\n'), /cleanup of .* failed/);
    assert.match(failed.join('\n'), /NOT archived: archive it by hand/);
    const silent = await run(path, { archiveSilentlyFails: true }).done;
    assert.match(silent.join('\n'), /NOT archived/);
  });
}

test('--keep skips cleanup', async () => {
  const w = world({ id: ID });
  const failures = await runCanary('console', {
    id: ID,
    token: 't',
    keep: true,
    freshSession: async () => assert.fail('no cleanup'),
    ghToken: 't',
    expectedWorkflow: WF,
    fetch: w.fetch,
    endState: { pollMs: 0, runTimeoutMs: 20, sleep: async () => {} },
  });
  assert.deepEqual(failures, []);
  assert.equal(w.state.deleted, false);
});

test('the console path uses the cookie session, the MCP path a bearer', async () => {
  const seen = [];
  const doFetch = async (url, init) => {
    seen.push({ url: String(url), headers: init.headers });
    return Response.json({ jsonrpc: '2.0', id: 1, result: {} });
  };
  await createGame('console', ID, 'tok', doFetch);
  await deleteGame('console', ID, 'tok', doFetch);
  assert.equal(seen[0].headers.Cookie, '__Host-fgs_token=tok');
  assert.equal(seen[1].headers.Cookie, '__Host-fgs_token=tok');
  assert.equal(seen[1].url, `https://console.freegamestore.online/api/games/${ID}`);
  seen.length = 0;
  await createGame('mcp', ID, 'tok', doFetch);
  assert.ok(seen.every((c) => c.headers.Authorization === 'Bearer tok'));
});
