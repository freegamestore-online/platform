// The create canary's keyless session on the MCP (#531): it may call create_game
// and delete_game on e2e-create-*-test ids, and no other tool.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Sources import the in-repo contracts as './x.js'; retry as .ts (see auth-handler.test.mjs).
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (/^\.\.?\//.test(specifier) && specifier.endsWith('.js')) {
        return nextResolve(specifier.replace(/\.js$/, '.ts'), context);
      }
      throw err;
    }
  },
});

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { canaryToolRefusal, resolveCanaryToken, isCanaryProps, CANARY_TOOLS } = await import(
  pathToFileURL(resolve(root, 'src/canary.ts')).href
);

const SUB = 'canary:freegamestore-online/platform';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const canaryJwt = `${b64({ alg: 'HS256' })}.${b64({ typ: 'fgs_canary', sub: SUB, canary: true })}.sig`;
const userJwt = `${b64({ alg: 'HS256' })}.${b64({ sub: 'github:1', login: 'alice' })}.sig`;
const CANARY = { canary: true, token: canaryJwt, sub: SUB };
const USER = { userId: 'alice', token: userJwt, sub: 'github:1' };

const toolNames = async () => {
  const src = (
    await Promise.all(
      ['catalog', 'game-files', 'build-session', 'admin'].map((m) =>
        readFile(resolve(root, `src/tools/${m}.ts`), 'utf8'),
      ),
    )
  ).join('\n');
  return [...src.matchAll(/ctx\.safeTool\(\s*["']([a-z_]+)["']/g)].map((m) => m[1]);
};

test('a canary session may call only create_game and delete_game', async () => {
  const names = await toolNames();
  assert.ok(names.length >= 20, `found the tool set (${names.length})`);
  assert.deepEqual([...CANARY_TOOLS].sort(), ['create_game', 'delete_game']);
  for (const tool of names) {
    const refusal = canaryToolRefusal(CANARY, tool, { game_id: 'e2e-create-mcp-abc-test' });
    if (CANARY_TOOLS.has(tool)) assert.equal(refusal, null, tool);
    else assert.match(refusal, /not available to a canary session/, tool);
  }
});

test('create_game and delete_game are for e2e-create-*-test ids only', () => {
  for (const tool of ['create_game', 'delete_game']) {
    for (const game_id of ['chess', 'e2e-create-x', 'my-e2e-create-x-test', '', undefined, 7])
      assert.match(canaryToolRefusal(CANARY, tool, { game_id }), /e2e-create-\*-test/, `${tool} ${game_id}`);
    assert.equal(canaryToolRefusal(CANARY, tool, { game_id: 'e2e-create-mcp-abc-test' }), null);
    // delete_game lowercases and trims before it acts, so the check sees the same id.
    assert.equal(canaryToolRefusal(CANARY, tool, { game_id: ' E2E-create-mcp-abc-test ' }), null);
    assert.match(canaryToolRefusal(CANARY, tool, undefined), /e2e-create-\*-test/);
  }
});

test('an ordinary session is not touched by the canary guard', async () => {
  for (const tool of await toolNames())
    assert.equal(canaryToolRefusal(USER, tool, { game_id: 'chess' }), null, tool);
  assert.equal(isCanaryProps(USER), false);
  assert.equal(isCanaryProps(undefined), false);
});

test('a canary-marked token is treated as the canary even without the props flag', () => {
  assert.equal(isCanaryProps({ token: canaryJwt }), true);
  assert.match(canaryToolRefusal({ token: canaryJwt }, 'whoami', {}), /not available/);
});

const authReturning = (status, body = { sub: SUB }, seen = []) => ({
  AUTH: {
    fetch: async (url, init) => {
      seen.push({ url, token: init.headers['X-FGS-Token'], body: JSON.parse(init.body) });
      return new Response(JSON.stringify(body), { status });
    },
  },
});

test('resolveCanaryToken has auth verify a canary token, and returns canary props', async () => {
  const seen = [];
  const res = await resolveCanaryToken({ token: canaryJwt, env: authReturning(200, { sub: SUB }, seen) });
  assert.deepEqual(res, { props: { canary: true, token: canaryJwt, sub: SUB } });
  assert.equal(res.props.userId, undefined, 'no GitHub login');
  assert.deepEqual(seen, [
    { url: 'https://auth.freegamestore.online/canary/authorize', token: canaryJwt, body: { action: 'verify' } },
  ]);
});

test('resolveCanaryToken accepts nothing else as an external token', async () => {
  const seen = [];
  assert.equal(await resolveCanaryToken({ token: userJwt, env: authReturning(200, { sub: SUB }, seen) }), null);
  assert.equal(await resolveCanaryToken({ token: 'junk', env: authReturning(200, { sub: SUB }, seen) }), null);
  assert.deepEqual(seen, [], 'auth is not even asked about a non-canary token');
  for (const status of [401, 403, 500])
    assert.equal(await resolveCanaryToken({ token: canaryJwt, env: authReturning(status) }), null);
  assert.equal(await resolveCanaryToken({ token: canaryJwt, env: authReturning(200, {}) }), null);
  const down = { AUTH: { fetch: async () => { throw new Error('down'); } } };
  assert.equal(await resolveCanaryToken({ token: canaryJwt, env: down }), null);
});

test('the guard is wired into every tool, and the provider takes only the canary as an external token', async () => {
  const index = await readFile(resolve(root, 'src/index.ts'), 'utf8');
  // safeTool is how every tool registers; the guard runs before the handler.
  assert.match(index, /canaryToolRefusal\(this\.session, name, callArgs\[0\]\)[\s\S]*return await \(cb as/);
  assert.match(index, /resolveExternalToken:\s*resolveCanaryToken/);
  assert.match(index, /props\?\.canary !== true/);
  // No tool registers around safeTool.
  for (const m of ['catalog', 'game-files', 'build-session', 'admin']) {
    const src = await readFile(resolve(root, `src/tools/${m}.ts`), 'utf8');
    assert.doesNotMatch(src, /ctx\.server\.tool\(/, m);
  }
});
