// #70 — list_files / read_file called GitHub with the ORG token for ANY
// game_id, so anyone signed in to MCP could read private org repos (e.g. this
// monorepo, `platform`). They must only read registry games, and must refuse
// everything else before any request to the target repo.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// The tool modules import siblings as './x.js' (TS NodeNext style); Node's type
// stripping loads .ts but won't map the .js specifier. Retry as .ts.
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
const { registerGameFilesTools } = await import(resolve(root, 'src/tools/game-files.ts'));
const { textToB64 } = await import(resolve(root, 'src/github.ts'));

const ORG = 'freegamestore-online';
const env = { GITHUB_ORG: ORG, STORE_REPO: 'platform', GITHUB_TOKEN: 'org-token' };
const REGISTRY = { games: [{ id: 'space-rescue', name: 'Space Rescue', creatorGithub: 'grace' }] };

/** Capture the registered tool handlers. */
function tools() {
  const handlers = {};
  registerGameFilesTools({
    env,
    session: {},
    safetyCtx: {},
    ownerSlug: ORG,
    ownsGame: async () => false,
    sessionPrefix: () => 'x',
    safeTool: (name, _desc, _schema, handler) => {
      handlers[name] = handler;
    },
  });
  return handlers;
}

/**
 * Fake GitHub. `registry` is 'ok' | 'unavailable'. Records every request so a
 * test can assert the target repo was never touched.
 */
async function withGitHub(registry, fn) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.includes(`/repos/${ORG}/platform/contents/sites/freegamestore/registry.json`)) {
      return registry === 'ok'
        ? json({ content: textToB64(JSON.stringify(REGISTRY)), encoding: 'base64' })
        : json({ message: 'Server Error' }, 503);
    }
    if (url.includes('raw.githubusercontent.com')) {
      return registry === 'ok' ? json(REGISTRY) : json({}, 503);
    }
    if (url.endsWith(`/repos/${ORG}/space-rescue/git/ref/heads/main`))
      return json({ object: { sha: 'h' } });
    if (url.includes(`/repos/${ORG}/space-rescue/git/trees/h`)) {
      return json({ tree: [{ type: 'blob', path: 'web/src/App.tsx' }] });
    }
    if (url.includes(`/repos/${ORG}/space-rescue/contents/web/src/App.tsx`)) {
      return json({ content: textToB64('export default 1;'), encoding: 'base64' });
    }
    // Anything else is a request to a repo we must never read.
    return json({ message: 'Not Found' }, 404);
  };
  try {
    return { result: await fn(), calls };
  } finally {
    globalThis.fetch = real;
  }
}

const touched = (calls, repo) =>
  calls.some((u) => u.includes(`/repos/${ORG}/${repo}/`) || u.endsWith(`/repos/${ORG}/${repo}`));

for (const tool of ['list_files', 'read_file']) {
  const call = (handlers, game_id) => handlers[tool]({ game_id, path: 'SESSION-HANDOFF.md' });

  test(`${tool}: refuses the private platform monorepo without reading it`, async () => {
    const { result, calls } = await withGitHub('ok', () => call(tools(), 'platform'));
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /not a game on FreeGameStore/);
    // The store registry now lives in platform (#213); only that read may touch it.
    const platformReads = calls.filter(
      (u) => u.includes(`/repos/${ORG}/platform/`) && !u.includes('/contents/sites/freegamestore/registry.json'),
    );
    assert.deepEqual(platformReads, []);
  });

  test(`${tool}: refuses a reserved id with no GitHub call at all`, async () => {
    const { result, calls } = await withGitHub('ok', () => call(tools(), 'template-game-canvas'));
    assert.equal(result.isError, true);
    assert.equal(calls.length, 0);
  });

  test(`${tool}: refuses a path-like id with no GitHub call at all`, async () => {
    const { result, calls } = await withGitHub('ok', () =>
      call(tools(), 'space-rescue/../platform'),
    );
    assert.equal(result.isError, true);
    assert.equal(calls.length, 0);
  });

  test(`${tool}: refuses a well-formed id that is not in the registry`, async () => {
    const { result, calls } = await withGitHub('ok', () => call(tools(), 'not-a-game'));
    assert.equal(result.isError, true);
    assert.equal(touched(calls, 'not-a-game'), false);
  });

  test(`${tool}: refuses (rather than reading) when the registry is unavailable`, async () => {
    const { result, calls } = await withGitHub('unavailable', () => call(tools(), 'space-rescue'));
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /registry is unavailable/);
    assert.equal(touched(calls, 'space-rescue'), false);
  });
}

test('list_files: still lists a registered game', async () => {
  const { result, calls } = await withGitHub('ok', () =>
    tools().list_files({ game_id: 'space-rescue' }),
  );
  assert.notEqual(result.isError, true);
  assert.match(result.content[0].text, /web\/src\/App\.tsx/);
  assert.equal(touched(calls, 'space-rescue'), true);
});

test('read_file: still reads a registered game', async () => {
  const { result } = await withGitHub('ok', () =>
    tools().read_file({ game_id: 'space-rescue', path: 'web/src/App.tsx' }),
  );
  assert.notEqual(result.isError, true);
  assert.match(result.content[0].text, /export default 1;/);
});
