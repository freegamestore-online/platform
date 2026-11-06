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
const { readRegistryGames, ownershipFacts, githubIdFromSub } = await import(
  pathToFileURL(resolve(root, 'src/github.ts')).href
);
const { validateGameId } = await import(
  pathToFileURL(resolve(root, '../../contracts/registry-ownership/v1/contract.ts')).href
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
    assert.equal(validateGameId(testCase.id) === null, testCase.valid, testCase.id);
});

// #487: MCP kept a private RESERVED_GAME_IDS (15 ids) that lacked 11 the
// contract reserves, so read_file/list_files accepted e.g. `platform`.
test('MCP validates game ids with the contract and keeps no copy of its reserved list', async () => {
  const srcDir = resolve(root, 'src');
  const { readdir } = await import('node:fs/promises');
  const files = (await readdir(srcDir, { recursive: true })).filter((f) => /\.ts$/.test(f));
  for (const file of files) {
    const src = await readFile(resolve(srcDir, file), 'utf8');
    assert.doesNotMatch(src, /RESERVED_GAME_IDS\s*=/, `${file} declares its own reserved list`);
    assert.doesNotMatch(src, /function validateGameId/, `${file} declares its own validateGameId`);
    if (/validateGameId\(/.test(src)) {
      assert.match(
        src,
        /import \{[^}]*validateGameId[^}]*\} from '(\.\.\/)+contracts\/registry-ownership\/v1\/contract\.js'/,
        `${file} must take validateGameId from the contract`,
      );
    }
  }
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

// #472: a GitHub login is mutable and re-assignable. ownsGame matches the
// registry's creatorGithubId against the session's `github:<id>` sub first.
test('ownership by GitHub id: id decides when both sides carry one, login otherwise', () => {
  const none = { isOrgMember: false, isLegacyAcceptedCollaborator: false };
  const game = { id: 'g', creatorGithub: 'old-name', creatorGithubId: '100' };
  // Renamed owner: new login, same id.
  assert.equal(ownershipFacts(game, 'new-name', none, githubIdFromSub('github:100')).isCreator, true);
  // Someone who registered the freed login: same login, different id.
  assert.equal(ownershipFacts(game, 'old-name', none, githubIdFromSub('github:200')).isCreator, false);
  // A pre-#472 grant without a sub falls back to the login.
  assert.equal(ownershipFacts(game, 'old-name', none, githubIdFromSub(undefined)).isCreator, true);
});

test('ownsGame passes the session sub to the ownership contract', async () => {
  const src = await readFile(resolve(root, 'src/index.ts'), 'utf8');
  const body = src.slice(src.indexOf('private async ownsGame'), src.indexOf('private safety()'));
  assert.match(body, /githubIdFromSub\(this\.session\.sub\)/);
});
