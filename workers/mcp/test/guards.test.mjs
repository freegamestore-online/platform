import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

// #445: rate limits (and a tighter one on /register), a streamed body bound, an
// Origin policy, and S256-only PKCE metadata.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { withRateLimits, withBoundedBody, withOriginPolicy, isAllowedOrigin, MAX_REQUEST_BODY_BYTES } =
  await import(pathToFileURL(resolve(root, 'src/guards.ts')).href);

const ok = async () => new Response('inner');
const req = (path = '/mcp', init = {}) => new Request(`https://mcp.freegamestore.online${path}`, init);
const limiter = (success = true) => {
  const keys = [];
  return { keys, async limit({ key }) { keys.push(key); return { success }; } };
};

test('every request is limited per IP; a refusal is a 429 with Retry-After', async () => {
  const allow = limiter();
  const handler = withRateLimits(ok);
  assert.equal(await (await handler(req('/mcp', { headers: { 'CF-Connecting-IP': '1.2.3.4' } }), { MCP_RATE_LIMIT: allow })).text(), 'inner');
  assert.deepEqual(allow.keys, ['mcp:1.2.3.4']);
  const res = await handler(req(), { MCP_RATE_LIMIT: limiter(false) });
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('Retry-After'), '60');
});

test('POST /register also spends the tighter registration limit; other routes and methods do not', async () => {
  const general = limiter();
  const register = limiter();
  const env = { MCP_RATE_LIMIT: general, MCP_REGISTER_LIMIT: register };
  const handler = withRateLimits(ok);
  const h = { headers: { 'CF-Connecting-IP': '9.9.9.9' } };
  await handler(req('/register', { method: 'POST', ...h }), env);
  assert.deepEqual(register.keys, ['mcp-register:9.9.9.9']);
  await handler(req('/mcp', { method: 'POST', ...h }), env);
  await handler(req('/register', { method: 'GET', ...h }), env);
  assert.equal(register.keys.length, 1);
  assert.equal(general.keys.length, 3);
  const blocked = await handler(req('/register', { method: 'POST', ...h }), { MCP_RATE_LIMIT: general, MCP_REGISTER_LIMIT: limiter(false) });
  assert.equal(blocked.status, 429);
});

test('unbound limiters (local dev, tests) do not limit', async () => {
  assert.equal(await (await withRateLimits(ok)(req('/register', { method: 'POST' }), {})).text(), 'inner');
});

test('a body over the cap is refused by its declared length', async () => {
  let called = false;
  const handler = withBoundedBody(async () => { called = true; return new Response('x'); });
  const res = await handler(req('/register', { method: 'POST', headers: { 'content-length': String(MAX_REQUEST_BODY_BYTES + 1) }, body: 'x' }), {});
  assert.equal(res.status, 413);
  assert.equal(called, false);
});

test('a body over the cap is refused as it streams, whatever Content-Length says', async () => {
  let called = false;
  const handler = withBoundedBody(async () => { called = true; return new Response('x'); });
  const big = new Uint8Array(MAX_REQUEST_BODY_BYTES + 1);
  const res = await handler(req('/register', { method: 'POST', body: big }), {});
  assert.equal(res.status, 413);
  assert.equal(called, false);
});

test('a small body passes through intact', async () => {
  const handler = withBoundedBody(async (r) => new Response(await r.text()));
  const res = await handler(req('/register', { method: 'POST', body: '{"client_name":"x"}' }), {});
  assert.equal(await res.text(), '{"client_name":"x"}');
});

test('only the listed browser origins are allowed', () => {
  for (const o of ['https://claude.ai', 'https://freegamestore.online', 'https://console.freegamestore.online', 'http://localhost:6274', 'http://127.0.0.1:3000']) {
    assert.equal(isAllowedOrigin(o), true, o);
  }
  for (const o of ['https://evil.example', 'https://claude.ai.evil.example', 'https://evil.freegamestore.online', 'https://localhost:1', 'http://localhost.evil.example', 'null', 'not a url']) {
    assert.equal(isAllowedOrigin(o), false, o);
  }
});

test('an unlisted Origin gets a 403 preflight and never reaches the provider', async () => {
  let called = false;
  const handler = withOriginPolicy(async () => { called = true; return new Response('x'); });
  const res = await handler(req('/mcp', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }), {});
  assert.equal(res.status, 403);
  assert.equal(called, false);
});

test('an unlisted Origin on a real request loses every CORS header, so the page cannot read it', async () => {
  const handler = withOriginPolicy(async () => new Response('body', { headers: { 'Access-Control-Allow-Origin': 'https://evil.example', 'access-control-expose-headers': 'x', 'x-keep': '1' } }));
  const res = await handler(req('/mcp', { method: 'POST', headers: { Origin: 'https://evil.example' } }), {});
  assert.equal(res.headers.get('access-control-allow-origin'), null);
  assert.equal(res.headers.get('access-control-expose-headers'), null);
  assert.equal(res.headers.get('x-keep'), '1');
  assert.equal(await res.text(), 'body');
});

test('a listed Origin and a request with no Origin are untouched', async () => {
  const handler = withOriginPolicy(async () => new Response('x', { headers: { 'Access-Control-Allow-Origin': 'https://claude.ai' } }));
  assert.equal((await handler(req('/mcp', { headers: { Origin: 'https://claude.ai' } }), {})).headers.get('access-control-allow-origin'), 'https://claude.ai');
  assert.equal((await handler(req('/mcp'), {})).headers.get('access-control-allow-origin'), 'https://claude.ai');
  assert.equal((await handler(req('/mcp', { method: 'OPTIONS', headers: { Origin: 'https://claude.ai' } }), {})).status, 200);
});
