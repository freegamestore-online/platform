// #29 — no upstream failure may reach the user as "Tool error: MCP tool call failed".
//
// The opaque wrapper is what the MCP SDK renders when an exception escapes a
// tool handler: it has nothing to serialize, so the user learns only that
// something broke, not which hop or why. Every test here drives a real failure
// mode of the outbound HTTP layer and asserts two things — that the call did
// NOT throw, and that what came back names the problem.
//
// Imports src/http.ts directly (Node strips the types on import). index.ts
// cannot be imported here: it pulls in `cloudflare:workers` and `agents/mcp`.
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { fgsApi, fgsPost, fgsDelete, getDeployStatus, readBody, safeFetch } = await import(
  pathToFileURL(resolve(root, 'src/http.ts')).href
);

const API = 'https://admin.freegamestore.online';

/** Swap in a fetch for the duration of one call, then always put it back. */
async function withFetch(impl, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

const ok = (body, status = 200) => new Response(body, { status });

/** A Response whose body read rejects — a truncated or reset stream. */
function unreadable(status = 200) {
  const res = new Response('', { status });
  Object.defineProperty(res, 'text', {
    value: () => Promise.reject(new TypeError('network error while reading body')),
  });
  return res;
}

// -- the empty-body returns: null means "no data", NOT an error --

test('204 No Content returns null rather than an error', async () => {
  const data = await withFetch(
    async () => new Response(null, { status: 204 }),
    () => fgsApi(API, '/api/quality'),
  );
  assert.equal(data, null);
});

test('a 200 with an empty body returns null', async () => {
  const data = await withFetch(
    async () => ok(''),
    () => fgsApi(API, '/api/status'),
  );
  assert.equal(data, null);
});

// -- the throwing paths: each must come back as a readable { error } --

test('a rejected fetch returns an error naming the path, and does not throw', async () => {
  const data = await withFetch(
    async () => {
      throw new TypeError('Network connection lost.');
    },
    () => fgsApi(API, '/api/status'),
  );
  assert.equal(typeof data.error, 'string');
  assert.match(data.error, /\/api\/status/, 'the message must say which hop failed');
  assert.match(data.error, /Network connection lost/, 'the underlying cause must survive');
});

test('an aborted fetch (withTimeout firing) returns an error, not a rejection', async () => {
  const data = await withFetch(
    async () => {
      const e = new Error('The operation was aborted');
      e.name = 'AbortError';
      throw e;
    },
    () => fgsApi(API, '/api/status'),
  );
  assert.match(data.error, /aborted/i);
});

test('a body read that rejects on a 200 is reported, not silently treated as empty', async () => {
  // The dangerous confusion: an unreadable body must not look like "no data",
  // because null is a success value that renders as "No games published yet."
  const data = await withFetch(
    async () => unreadable(200),
    () => fgsApi(API, '/api/status'),
  );
  assert.notEqual(data, null, 'unreadable must not be mistaken for empty');
  assert.match(data.error, /Failed to read response body/);
  assert.match(data.error, /\/api\/status/);
});

test('a non-OK response with an unreadable body still reports its status', async () => {
  const data = await withFetch(
    async () => unreadable(503),
    () => fgsApi(API, '/api/status'),
  );
  assert.match(data.error, /API 503/, 'the status is known even when the body is not');
});

test('a non-OK response includes the body when it can be read', async () => {
  const data = await withFetch(
    async () => ok('upstream is down', 502),
    () => fgsApi(API, '/api/status'),
  );
  assert.match(data.error, /API 502/);
  assert.match(data.error, /upstream is down/);
});

test('malformed JSON is reported with a bounded excerpt', async () => {
  const data = await withFetch(
    async () => ok('<html>not json</html>'),
    () => fgsApi(API, '/api/status'),
  );
  assert.match(data.error, /Invalid JSON/);
  assert.match(data.error, /not json/);
});

test('a well-formed body is parsed and returned unchanged', async () => {
  const data = await withFetch(
    async () => ok(JSON.stringify([{ id: 'chess' }])),
    () => fgsApi(API, '/api/status'),
  );
  assert.deepEqual(data, [{ id: 'chess' }]);
});

// -- the same contract for the other callers --

test('fgsPost returns an error instead of throwing when the hop fails', async () => {
  const data = await withFetch(
    async () => {
      throw new TypeError('connection reset');
    },
    () => fgsPost(API, '/api/publish', 'tok', { game_id: 'chess' }),
  );
  assert.match(data.error, /\/api\/publish/);
  assert.match(data.error, /connection reset/);
});

test('fgsDelete returns an error instead of throwing when the hop fails', async () => {
  const data = await withFetch(
    async () => {
      throw new TypeError('connection reset');
    },
    () => fgsDelete(API, '/api/games/chess', 'tok'),
  );
  assert.match(data.error, /\/api\/games\/chess/);
});

test('fgsPost reports an unreadable body rather than parsing empty', async () => {
  const data = await withFetch(
    async () => unreadable(200),
    () => fgsPost(API, '/api/publish', 'tok', {}),
  );
  assert.match(data.error, /Failed to read response body/);
});

test('getDeployStatus returns an error instead of throwing when GitHub is unreachable', async () => {
  const data = await withFetch(
    async () => {
      throw new TypeError('getaddrinfo ENOTFOUND api.github.com');
    },
    () => getDeployStatus('freegamestore-online', 'chess'),
  );
  assert.ok(!Array.isArray(data), 'a failure must not look like an empty run list');
  assert.match(data.error, /GitHub Actions API/);
  assert.match(data.error, /ENOTFOUND/);
});

test('getDeployStatus still returns runs on the happy path', async () => {
  const data = await withFetch(
    async () =>
      ok(
        JSON.stringify({
          workflow_runs: [
            {
              name: 'Deploy',
              conclusion: 'success',
              status: 'completed',
              updated_at: '2026-01-01T00:00:00Z',
              html_url: 'u',
              head_sha: 'abcdef1234',
            },
          ],
        }),
      ),
    () => getDeployStatus('freegamestore-online', 'chess'),
  );
  assert.equal(data.length, 1);
  assert.equal(data[0].status, 'success');
  assert.equal(data[0].sha, 'abcdef1');
});

// -- the primitives --

test('safeFetch labels the hop it was given', async () => {
  // safeFetch invokes the callback it is handed, so the throw belongs there —
  // swapping globalThis.fetch would not reach it.
  const r = await safeFetch('the leaderboard API', async () => {
    throw new Error('boom');
  });
  assert.match(r.error, /the leaderboard API/);
  assert.match(r.error, /boom/);
});

test('safeFetch passes the response straight through on success', async () => {
  const r = await safeFetch('anything', async () => new Response('hi', { status: 200 }));
  assert.equal(r.error, undefined);
  assert.equal(await r.res.text(), 'hi');
});

test('readBody distinguishes an empty body from an unreadable one', async () => {
  assert.deepEqual(await readBody(ok('')), { text: '' });
  const bad = await readBody(unreadable());
  assert.equal(bad.text, undefined);
  assert.match(bad.error, /network error/);
});
