// #162 — game_info must surface a remix's lineage (`forkedFrom`) from the
// registry. Remixes store an attribution object; legacy entries store the source
// id as a bare string. Games with no lineage get no line at all.
import assert from 'node:assert/strict';
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
const { registerCatalogTools, forkLine } = await import(
  pathToFileURL(resolve(root, 'src/tools/catalog.ts')).href
);
const { textToB64 } = await import(pathToFileURL(resolve(root, 'src/github.ts')).href);

const env = { GITHUB_ORG: 'freegamestore-online', STORE_REPO: 'platform', GITHUB_TOKEN: 'org-token' };

const ATTRIBUTION = {
  id: 'chess',
  name: 'Chess',
  creatorGithub: 'original-creator',
  forkedAt: '2026-09-25T00:00:00.000Z',
};

/** Capture the game_info handler as registered. */
function gameInfo() {
  const handlers = {};
  registerCatalogTools({
    env,
    safeTool: (name, _desc, _schema, handler) => {
      handlers[name] = handler;
    },
  });
  return handlers.game_info;
}

/**
 * Serve the given registry from the GitHub Contents API and answer every other
 * request (the live-URL HEAD probe) with 200. Restores fetch when done.
 */
async function withRegistry(games, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.startsWith('https://api.github.com/') && url.includes('/contents/sites/freegamestore/registry.json')) {
      const content = textToB64(JSON.stringify({ games }));
      return new Response(JSON.stringify({ content, encoding: 'base64' }), { status: 200 });
    }
    return new Response('', { status: 200 });
  };
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

async function infoText(gameId, games) {
  return withRegistry(games, async () => {
    const result = await gameInfo()({ game_id: gameId });
    return result.content[0].text;
  });
}

test('forkLine renders an attribution object with name, creator and fork date', () => {
  assert.equal(
    forkLine(ATTRIBUTION),
    'Remixed from: Chess (chess) by @original-creator, forked 2026-09-25T00:00:00.000Z',
  );
});

test('forkLine renders a legacy bare-string source id', () => {
  assert.equal(forkLine('chess'), 'Remixed from: chess');
});

test('forkLine returns null when there is no usable lineage', () => {
  for (const value of [undefined, null, '', '   ', 42, {}, { name: 'orphan' }]) {
    assert.equal(forkLine(value), null, `expected null for ${JSON.stringify(value)}`);
  }
});

test('game_info lists the lineage for a remix, between Repo and Listing', async () => {
  const text = await infoText('chess-remix', [
    { id: 'chess', name: 'Chess', creatorGithub: 'original-creator', status: 'live' },
    {
      id: 'chess-remix',
      name: 'Chess Remix',
      creatorGithub: 'remixer',
      status: 'live',
      forkedFrom: ATTRIBUTION,
    },
  ]);
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.startsWith('Remixed from:'));
  assert.notEqual(at, -1, `no lineage line in:\n${text}`);
  assert.equal(
    lines[at],
    'Remixed from: Chess (chess) by @original-creator, forked 2026-09-25T00:00:00.000Z',
  );
  assert.equal(lines[at - 1], 'Repo: https://github.com/freegamestore-online/chess-remix');
  assert.equal(lines[at + 1], 'Listing: https://freegamestore.online/games/chess-remix');
});

test('game_info omits the lineage line for a game that was not remixed', async () => {
  const text = await infoText('chess', [
    { id: 'chess', name: 'Chess', creatorGithub: 'original-creator', status: 'live' },
  ]);
  assert.doesNotMatch(text, /Remixed from/);
});

test('game_info omits the lineage line for an unlisted game', async () => {
  const text = await infoText('ghost', [
    { id: 'chess', name: 'Chess', creatorGithub: 'original-creator', status: 'live' },
  ]);
  assert.match(text, /Status: Not listed in the store registry/);
  assert.doesNotMatch(text, /Remixed from/);
});

test('game_info shows a legacy string lineage as the source id', async () => {
  const text = await infoText('old-remix', [
    { id: 'old-remix', name: 'Old Remix', creatorGithub: 'remixer', status: 'live', forkedFrom: 'chess' },
  ]);
  assert.match(text, /^Remixed from: chess$/m);
});
