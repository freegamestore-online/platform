import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Tool modules import siblings as './x.js'; Node's type stripping loads .ts but
// won't map the .js specifier. Retry as .ts.
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
const contracts = resolve(root, '../../contracts/registry-ownership-remix/v1');
const { readRegistryGames, ownershipFacts, validateGameId } = await import(
  pathToFileURL(resolve(root, 'src/github.ts')).href
);
const load = async (name) => JSON.parse(await readFile(resolve(contracts, name), 'utf8'));

async function withFetch(contents, raw, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const state = String(url).includes('raw.githubusercontent') ? raw : contents;
    if (state === 'success')
      return String(url).includes('raw.githubusercontent')
        ? new Response(JSON.stringify({ games: [] }))
        : new Response(JSON.stringify({ content: btoa(JSON.stringify({ games: [] })) }));
    if (state === 'missing') return new Response('', { status: 404 });
    if (state === 'malformed')
      return String(url).includes('raw.githubusercontent')
        ? new Response(JSON.stringify({ nope: [] }))
        : new Response(JSON.stringify({ content: btoa('{not json') }));
    return new Response('', { status: 401 });
  };
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

test('registry-ownership contract v1: canonical IDs', async () => {
  const fixture = await load('id-cases.json');
  for (const testCase of fixture.cases)
    assert.equal(validateGameId(testCase.id), testCase.valid, testCase.id);
});

test('registry-ownership contract v1: registry result states', async () => {
  const fixture = await load('registry-cases.json');
  for (const testCase of fixture.cases) {
    const result = await withFetch(testCase.contents, testCase.raw, () =>
      readRegistryGames('org', 'store', 'token'),
    );
    assert.equal(result.status, testCase.expected, testCase.name);
  }
});

test('registry-ownership contract v1: ownership facts', async () => {
  const fixture = await load('ownership-cases.json');
  for (const testCase of fixture.cases) {
    assert.deepEqual(
      ownershipFacts(
        testCase.creatorGithub
          ? { id: 'source-game', creatorGithub: testCase.creatorGithub }
          : { id: 'source-game' },
        testCase.login,
        {
          isOrgMember: testCase.isOrgMember,
          isLegacyAcceptedCollaborator: testCase.isLegacyAcceptedCollaborator,
        },
      ),
      testCase.expected,
      testCase.name,
    );
  }
});
