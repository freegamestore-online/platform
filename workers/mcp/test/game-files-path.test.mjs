// #456 — read_file's `path` could walk the Contents URL into another repo.
// `encodeURIComponent('..')` is `..`, and GitHub resolves dot segments, so
//   read_file({ game_id: 'space-rescue', path: '../../platform/contents/x' })
// passed the #70 game-id/registry gate on a real game and then requested
//   /repos/<org>/space-rescue/contents/../../platform/contents/x
//   → /repos/<org>/platform/contents/x            (with the org token)
// Every path is now shape-checked before any request, and every GitHub URL the
// worker builds is parsed back and asserted to still be inside org/repo.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
const { registerGameFilesTools } = await import(pathToFileURL(resolve(root, 'src/tools/game-files.ts')).href);
const { GitHubError, readRepoFile, listRepoFiles, repoPathError, textToB64 } = await import(
  pathToFileURL(resolve(root, 'src/github.ts')).href
);
const { githubRepoUrl, getDeployStatus } = await import(pathToFileURL(resolve(root, 'src/http.ts')).href);

const ORG = 'freegamestore-online';
const env = { GITHUB_ORG: ORG, STORE_REPO: 'platform', GITHUB_TOKEN: 'org-token' };
const REGISTRY = { games: [{ id: 'space-rescue', name: 'Space Rescue', creatorGithub: 'grace' }] };

// The exact payload from the report: a registered game id, a path that climbs
// out of its contents/ and into the private monorepo.
const PAYLOAD = { game_id: 'space-rescue', path: '../../platform/contents/SESSION-HANDOFF.md' };

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

/** Fake GitHub that records every request URL as the server would see it
 *  (dot segments resolved, exactly like a real HTTP client/server pair). */
async function withGitHub(fn) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input)).toString();
    calls.push(url);
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.includes(`/repos/${ORG}/platform/contents/sites/freegamestore/registry.json`)) {
      return json({ content: textToB64(JSON.stringify(REGISTRY)), encoding: 'base64' });
    }
    if (url.includes('raw.githubusercontent.com')) return json(REGISTRY);
    // The private file the traversal targets. Serving it (rather than 404) is
    // what makes a leak observable in the assertion below.
    if (url.includes(`/repos/${ORG}/platform/contents/SESSION-HANDOFF.md`)) {
      return json({ content: textToB64('PRIVATE HANDOFF NOTES'), encoding: 'base64' });
    }
    return json({ message: 'Not Found' }, 404);
  };
  try {
    return { result: await fn(), calls };
  } finally {
    globalThis.fetch = real;
  }
}

const leaked = (calls) => calls.some((u) => u.includes(`/repos/${ORG}/platform/contents/SESSION-HANDOFF.md`));

test('read_file: the ../../<repo>/contents/<file> payload is refused and never reaches the other repo', async () => {
  const { result, calls } = await withGitHub(() => tools().read_file(PAYLOAD));
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Invalid path/);
  assert.doesNotMatch(result.content[0].text, /PRIVATE HANDOFF NOTES/);
  assert.equal(leaked(calls), false);
  // Refused on shape alone — before the registry read, before any request.
  assert.deepEqual(calls, []);
});

test('read_file: every traversal spelling is refused without a request', async () => {
  for (const path of [
    '..',
    '../x',
    'a/../../platform/contents/x',
    'a/./b',
    '/etc/passwd',
    'a//b',
    'a/',
    '%2e%2e/%2e%2e/platform/contents/x',
    'a%2f..%2fb',
    'a\\..\\b',
    '',
  ]) {
    const { result, calls } = await withGitHub(() => tools().read_file({ game_id: 'space-rescue', path }));
    assert.equal(result.isError, true, `path ${JSON.stringify(path)} must be refused`);
    assert.deepEqual(calls, [], `path ${JSON.stringify(path)} must not be requested`);
  }
});

test('read_file: an ordinary nested path still reads', async () => {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.includes('/contents/sites/freegamestore/registry.json')) {
      return json({ content: textToB64(JSON.stringify(REGISTRY)), encoding: 'base64' });
    }
    if (url.endsWith(`/repos/${ORG}/space-rescue/contents/web/src/App.tsx`)) {
      return json({ content: textToB64('export default 1;'), encoding: 'base64' });
    }
    return json({ message: 'Not Found' }, 404);
  };
  try {
    const result = await tools().read_file({ game_id: 'space-rescue', path: 'web/src/App.tsx' });
    assert.notEqual(result.isError, true);
    assert.match(result.content[0].text, /export default 1;/);
  } finally {
    globalThis.fetch = real;
  }
});

test('repoPathError: accepts normal paths, names the problem otherwise', () => {
  assert.equal(repoPathError('web/src/App.tsx'), null);
  assert.equal(repoPathError('README.md'), null);
  assert.equal(repoPathError('.github/workflows/deploy.yml'), null);
  assert.match(repoPathError('../x'), /\.\./);
  assert.match(repoPathError('/x'), /leading/);
  assert.match(repoPathError('a//b'), /empty/);
  assert.match(repoPathError('a%2fb'), /%/);
  assert.match(repoPathError('a\\b'), /\\/);
  assert.match(repoPathError(''), /required/);
  assert.match(repoPathError(undefined), /required/);
});

test('readRepoFile: throws GitHubError for a traversal path before fetching', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('must not fetch');
  };
  try {
    await assert.rejects(
      readRepoFile(ORG, 'space-rescue', 'tok', PAYLOAD.path),
      (e) => e instanceof GitHubError && /refusing to read/.test(e.message),
    );
  } finally {
    globalThis.fetch = real;
  }
});

test('githubRepoUrl: encodes and refuses any subpath or repo that escapes /repos/<org>/<repo>/', () => {
  assert.equal(
    githubRepoUrl(ORG, 'space-rescue', 'contents/web/src/App.tsx'),
    `https://api.github.com/repos/${ORG}/space-rescue/contents/web/src/App.tsx`,
  );
  assert.equal(
    githubRepoUrl(ORG, 'space-rescue', 'git/trees/abc?recursive=1'),
    `https://api.github.com/repos/${ORG}/space-rescue/git/trees/abc?recursive=1`,
  );
  assert.throws(() => githubRepoUrl(ORG, 'space-rescue', 'contents/../../platform/contents/x'), /outside/);
  assert.throws(() => githubRepoUrl(ORG, 'space-rescue', '../platform/contents/x'), /outside/);
  assert.throws(() => githubRepoUrl(ORG, '..', 'contents/x'), /outside/);
  // A repo name with slashes is encoded (#70), so it stays one (nonexistent)
  // segment rather than becoming a path.
  assert.match(
    githubRepoUrl(ORG, 'space-rescue/../platform', 'contents/x'),
    /\/repos\/freegamestore-online\/space-rescue%2F\.\.%2Fplatform\/contents\/x$/,
  );
});

test('listRepoFiles / getDeployStatus: a repo name that escapes is refused, not requested', async () => {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ workflow_runs: [] }), { status: 200 });
  };
  try {
    await assert.rejects(listRepoFiles(ORG, '..', 'tok'), /outside/);
    // getDeployStatus never throws (#29): the refusal comes back as { error }.
    const status = await getDeployStatus(ORG, '..');
    assert.match(status.error, /outside/);
    assert.deepEqual(calls, []);
  } finally {
    globalThis.fetch = real;
  }
});
