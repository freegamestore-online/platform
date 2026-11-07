import assert from 'node:assert/strict';
import test from 'node:test';
import { checkEndState } from './create-canary.mjs';

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
