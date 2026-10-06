import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

function runProbe(failurePath, status = 200, token = 'test-token') {
  const script = new URL('./fleet-health.mjs', import.meta.url).href;
  const mock = `
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes(${JSON.stringify(failurePath)})) return new Response('{}', {status: ${status}});
      if (url.endsWith('/contents/sites/freegamestore/registry.json')) return Response.json({content: Buffer.from(JSON.stringify({games: [{id: 'chess'}]})).toString('base64')});
      if (url.endsWith('/repos/freegamestore-online/chess')) return Response.json({archived: false});
      if (url.includes('/actions/runs')) return Response.json({workflow_runs: []});
      if (url.includes('/contents/')) return new Response('{}', {status: 404});
      return new Response('', {status: 200});
    };
    await import(${JSON.stringify(script)});
  `;
  return spawnSync(process.execPath, ['--input-type=module', '-e', mock], {
    env: { ...process.env, GH_TOKEN: token, GITHUB_TOKEN: '', CI: '1' },
    encoding: 'utf8',
  });
}

test('healthy probe succeeds; missing token fails with exit 2', () => {
  assert.equal(runProbe('never-matches').status, 0);
  assert.equal(runProbe('never-matches', 200, '').status, 2);
});

for (const path of [
  '/contents/sites/freegamestore/registry.json',
  '/repos/freegamestore-online/chess',
  '/contents/web/package.json',
  '/contents/pnpm-lock.yaml',
  '/actions/runs',
]) {
  for (const status of [401, 403, 429, 500]) {
    test(`GitHub ${status} at ${path} fails rather than reporting healthy`, () => {
      const result = runProbe(path, status);
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, new RegExp(`HTTP ${status}`));
      assert.doesNotMatch(result.stdout, /all games healthy/);
    });
  }
}

test('missing game repository is unhealthy, not an API error', () => {
  const result = runProbe('/repos/freegamestore-online/chess', 404);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /repo missing/);
});
