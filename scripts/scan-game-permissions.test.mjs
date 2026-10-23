import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import * as compliance from '../packages/compliance/dist/index.js';
import { scanGames } from './scan-game-permissions.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'fgs-permissions-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const registryPath = join(root, 'registry.json');
  const outputPath = join(root, 'game-permissions.json');
  const clones = join(root, 'clones');
  mkdirSync(clones);
  const previous = {
    generatedAt: '2020-01-01T00:00:00.000Z',
    games: { chess: { declared: {}, detected: [] } },
  };
  writeFileSync(outputPath, `${JSON.stringify(previous, null, 2)}\n`);
  writeFileSync(registryPath, JSON.stringify({ games: [{ id: 'chess' }] }));
  const putGame = (id, source = '') => {
    const dir = join(clones, id);
    mkdirSync(join(dir, '.git'), { recursive: true });
    mkdirSync(join(dir, 'web/src'), { recursive: true });
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ freegamestore: { permissions: {} } }),
    );
    writeFileSync(join(dir, 'web/src/main.js'), source);
  };
  putGame('chess');
  return { root, registryPath, outputPath, clones, putGame, compliance };
}

test('unchanged permissions preserve the exact file and generatedAt', async (t) => {
  const options = fixture(t);
  const before = readFileSync(options.outputPath, 'utf8');
  const result = await scanGames({ ...options, runGit: () => {} });
  assert.equal(result.changed, false);
  assert.deepEqual(result.failed, []);
  assert.equal(readFileSync(options.outputPath, 'utf8'), before);
});

test('changed permissions are written after refreshing a cached clone', async (t) => {
  const options = fixture(t);
  const calls = [];
  const result = await scanGames({
    ...options,
    runGit: (command, args) => {
      calls.push([command, ...args]);
      if (args.includes('reset'))
        options.putGame('chess', 'navigator.mediaDevices.getUserMedia({audio:true});');
    },
  });
  const dir = join(options.clones, 'chess');
  assert.deepEqual(calls, [
    ['git', '-C', dir, 'fetch', '--depth=1', 'origin', 'HEAD'],
    ['git', '-C', dir, 'reset', '--hard', 'FETCH_HEAD'],
  ]);
  assert.equal(result.changed, true);
  const data = JSON.parse(readFileSync(options.outputPath, 'utf8'));
  assert.deepEqual(data.games.chess.detected, ['microphone']);
  assert.notEqual(data.generatedAt, '2020-01-01T00:00:00.000Z');
});

test('failed refresh retains previous permissions and still scans later games', async (t) => {
  const options = fixture(t);
  writeFileSync(
    options.registryPath,
    JSON.stringify({ games: [{ id: 'chess' }, { id: 'new-game' }] }),
  );
  const result = await scanGames({
    ...options,
    runGit: (_command, args) => {
      if (args.includes('fetch')) throw new Error('offline');
      options.putGame('new-game', 'navigator.geolocation.getCurrentPosition(showPosition);');
    },
  });
  assert.deepEqual(result.failed, ['chess']);
  const data = JSON.parse(readFileSync(options.outputPath, 'utf8'));
  assert.deepEqual(data.games.chess, { declared: {}, detected: [] });
  assert.deepEqual(data.games['new-game'].detected, ['location']);
});

test('CLI exits nonzero after a partial failure and processes every selected game offline', (t) => {
  const options = fixture(t);
  const script = join(options.root, 'scripts/scan-game-permissions.mjs');
  mkdirSync(join(options.root, 'scripts'));
  copyFileSync(new URL('./scan-game-permissions.mjs', import.meta.url), script);
  const site = join(options.root, 'sites/freegamestore');
  mkdirSync(site, { recursive: true });
  writeFileSync(
    join(site, 'registry.json'),
    JSON.stringify({ games: [{ id: 'broken' }, { id: 'chess' }] }),
  );
  const moduleDir = join(options.root, 'packages/compliance/dist');
  mkdirSync(moduleDir, { recursive: true });
  writeFileSync(join(options.root, 'package.json'), '{"type":"module"}');
  writeFileSync(
    join(moduleDir, 'index.js'),
    `export * from ${JSON.stringify(new URL('../packages/compliance/dist/index.js', import.meta.url).href)};`,
  );
  const bootstrap = `
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    childProcess.execFileSync = (_command, args) => {
      if (args.includes('clone')) throw new Error('offline clone failure');
    };
    syncBuiltinESMExports();
    process.argv = [process.execPath, ${JSON.stringify(script)}, '--clones', ${JSON.stringify(options.clones)}];
    await import(${JSON.stringify(pathToFileURL(script).href)});
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', bootstrap], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /could not scan: broken/);
  const data = JSON.parse(readFileSync(join(site, 'game-permissions.json'), 'utf8'));
  assert.deepEqual(data.games.chess, { declared: {}, detected: [] });
  assert.equal(data.games.broken, undefined);
});

test('scheduled workflow publishes only changes and explicitly dispatches the existing deploy workflow', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/scan-game-permissions.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /cron: '0 2 \* \* \*'/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /actions: write/);
  assert.match(workflow, /GH_TOKEN: \$\{\{ secrets.GITHUB_TOKEN \}\}/);
  assert.match(workflow, /actions\/cache@v4/);
  assert.match(workflow, /git diff --quiet -- sites\/freegamestore\/game-permissions.json/);
  const steps = [
    'pnpm --filter @freegamestore/compliance build',
    'node scripts/scan-game-permissions.mjs --clones .game-clones',
    'git diff --quiet',
    'git commit',
    'git push origin HEAD:main',
    'gh workflow run deploy-storefront.yml --ref main',
  ];
  let previous = -1;
  for (const step of steps) {
    const index = workflow.indexOf(step);
    assert.ok(index > previous, `${step} must run in order`);
    previous = index;
  }
  assert.doesNotMatch(workflow, /continue-on-error:|\|\| true/);
});
