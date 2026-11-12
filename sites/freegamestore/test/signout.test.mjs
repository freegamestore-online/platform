import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// #498: the first-party sign-out page games send the player to.

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..');
const { safeReturn, signOut } = createRequire(import.meta.url)('../signout.js');
const HOME = 'https://freegamestore.online/';

test('signout returns only to https freegamestore.online pages', () => {
  assert.equal(safeReturn('https://chess.freegamestore.online/play?x=1'), 'https://chess.freegamestore.online/play?x=1');
  assert.equal(safeReturn('https://freegamestore.online/games/chess'), 'https://freegamestore.online/games/chess');
  for (const bad of [
    null,
    '',
    '/relative',
    'https://evil.example/',
    'https://freegamestore.online.evil.example/',
    'https://evilfreegamestore.online/',
    'http://chess.freegamestore.online/',
    'https://user:pw@chess.freegamestore.online/',
    'javascript:alert(1)',
    '//evil.example/',
    'http://localhost:5173/',
  ]) {
    assert.equal(safeReturn(bad), HOME, String(bad));
  }
});

test('signout POSTs auth logout with credentials and treats its redirect as success', async () => {
  const calls = [];
  const fake = (response) => async (url, init) => {
    calls.push({ url, init });
    if (response instanceof Error) throw response;
    return response;
  };
  assert.equal(await signOut(fake({ type: 'opaqueredirect', ok: false })), true);
  assert.equal(calls[0].url, 'https://auth.freegamestore.online/v1/logout');
  assert.deepEqual(calls[0].init, { method: 'POST', credentials: 'include', redirect: 'manual' });
  // Auth's 403 (refused origin) and a network failure are both failures.
  assert.equal(await signOut(fake({ type: 'cors', ok: false, status: 403 })), false);
  assert.equal(await signOut(fake(new TypeError('offline'))), false);
});

test('the signout page waits for a click, is not indexed, and is built into dist', () => {
  const html = readFileSync(join(SITE, 'signout.html'), 'utf8');
  assert.match(html, /<meta name="robots" content="noindex"/);
  assert.match(html, /<button id="signout-confirm"/);
  assert.match(html, /<script src="\/signout.js" defer><\/script>/);
  const js = readFileSync(join(SITE, 'signout.js'), 'utf8');
  // The POST happens only in the click handler.
  assert.ok(js.indexOf("addEventListener('click'") < js.lastIndexOf('signOut(fetch'));
  const build = readFileSync(join(SITE, 'build.js'), 'utf8');
  assert.match(build, /'signout\.html',\r?\n\s*'signout\.js',/);
  assert.match(build, /frame-ancestors 'none'/);
});
