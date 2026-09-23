// #40 — a GitHub failure must never read as "no files" / "file not found".
//
// listRepoFiles/readRepoFile/readRegistryGames return empty/null ONLY for
// confirmed absence (404, or 409 for an empty repo). Anything else — auth,
// rate limit, outage — throws, so safeTool reports the real cause.
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { listRepoFiles, readRepoFile, readRegistryGames, GitHubError, textToB64 } = await import(
  resolve(root, 'src/github.ts')
);

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

/** Route fetches by URL substring; an unmatched URL fails the test loudly. */
async function withFetch(routes, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    for (const [needle, res] of routes) if (String(url).includes(needle)) return res();
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

const REF = ['/git/ref/heads/main', () => json({ object: { sha: 'abc' } })];

test('listRepoFiles: lists blobs on success', async () => {
  const files = await withFetch(
    [
      REF,
      [
        '/git/trees/abc',
        () =>
          json({
            tree: [
              { type: 'blob', path: 'a.ts' },
              { type: 'tree', path: 'src' },
            ],
          }),
      ],
    ],
    () => listRepoFiles('org', 'game'),
  );
  assert.deepEqual(files, ['a.ts']);
});

test('listRepoFiles: [] for a missing repo (404) and an empty repo (409)', async () => {
  for (const status of [404, 409]) {
    const files = await withFetch(
      [['/git/ref/heads/main', () => json({ message: 'x' }, status)]],
      () => listRepoFiles('org', 'game'),
    );
    assert.deepEqual(files, [], `status ${status}`);
  }
});

test('listRepoFiles: throws on ref 401/403/500 instead of returning []', async () => {
  for (const status of [401, 403, 500]) {
    await assert.rejects(
      withFetch([['/git/ref/heads/main', () => json({ message: 'boom' }, status)]], () =>
        listRepoFiles('org', 'game'),
      ),
      (e) => e instanceof GitHubError && e.status === status && e.message.includes(String(status)),
    );
  }
});

test('listRepoFiles: throws when the tree fetch fails after a good ref', async () => {
  await assert.rejects(
    withFetch(
      [REF, ['/git/trees/abc', () => json({ message: 'API rate limit exceeded' }, 403)]],
      () => listRepoFiles('org', 'game'),
    ),
    /rate limit/,
  );
});

test('readRepoFile: decodes content on success, null on 404', async () => {
  const ok = await withFetch([['/contents/a.ts', () => json({ content: textToB64('hé') })]], () =>
    readRepoFile('org', 'game', undefined, 'a.ts'),
  );
  assert.equal(ok, 'hé');
  const missing = await withFetch(
    [['/contents/a.ts', () => json({ message: 'Not Found' }, 404)]],
    () => readRepoFile('org', 'game', undefined, 'a.ts'),
  );
  assert.equal(missing, null);
});

test('readRepoFile: throws on 401/502 instead of returning null', async () => {
  for (const status of [401, 502]) {
    await assert.rejects(
      withFetch([['/contents/a.ts', () => json({ message: 'nope' }, status)]], () =>
        readRepoFile('org', 'game', undefined, 'a.ts'),
      ),
      (e) => e instanceof GitHubError && e.status === status,
    );
  }
});

test('readRepoFile: throws for a directory path rather than calling it missing', async () => {
  await assert.rejects(
    withFetch([['/contents/src', () => json([{ name: 'a.ts' }])]], () =>
      readRepoFile('org', 'game', undefined, 'src'),
    ),
    /not a readable file/,
  );
});

test('readRegistryGames: throws on an upstream failure instead of returning no games', async () => {
  await assert.rejects(
    withFetch([['/contents/registry.json', () => json({ message: 'Server Error' }, 503)]], () =>
      readRegistryGames('org', 'store'),
    ),
    GitHubError,
  );
});

test('readRegistryGames: throws on malformed JSON, [] only when the file is absent', async () => {
  await assert.rejects(
    withFetch([['/contents/registry.json', () => json({ content: textToB64('{not json') })]], () =>
      readRegistryGames('org', 'store'),
    ),
    /not valid JSON/,
  );
  const none = await withFetch([['/contents/registry.json', () => json({}, 404)]], () =>
    readRegistryGames('org', 'store'),
  );
  assert.deepEqual(none, []);
});
