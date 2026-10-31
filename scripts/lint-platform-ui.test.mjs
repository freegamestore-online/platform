import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  BASELINE_PATH,
  evaluate,
  run,
  SURFACES,
  scanSource,
  scanSurface,
} from './lint-platform-ui.mjs';

// platform#396: the platform-UI lint counts runtime CSS injection and static
// inline styles per surface, and ratchets against a committed baseline.

test('scanSource counts static inline styles', () => {
  const src =
    'export const A = () => <div style={{ color: "red" }} />;\nexport const B = () => <p style={{ margin: 0 }} />;';
  assert.deepEqual(scanSource(src), { cssInjection: 0, inlineStyles: 2 });
});

test('scanSource skips an inline style carrying a "dynamic" comment', () => {
  const covered = [
    '// dynamic: sprite position',
    'const a = <div style={{ left: x }} />;',
    'const b = <div /* dynamic: progress */ style={{ width: p }} />;',
  ].join('\n');
  assert.equal(scanSource(covered).inlineStyles, 0);

  // The comment only covers the style within three lines below it.
  const far = [
    '// dynamic: sprite position',
    '',
    '',
    '',
    'const c = <div style={{ color: "red" }} />;',
  ].join('\n');
  assert.equal(scanSource(far).inlineStyles, 1);
});

test('scanSource counts runtime CSS injection forms', () => {
  const src = [
    'const a = <style>{CSS}</style>;',
    'const el = document.createElement("style");',
    'sheet.insertRule(".a{}");',
    'document.adoptedStyleSheets = [new CSSStyleSheet()];',
  ].join('\n');
  assert.equal(scanSource(src).cssInjection, 5);
});

test('scanSource ignores injection and styles that only appear in comments', () => {
  const src = [
    '// <style>{CSS}</style> and style={{ a: 1 }}',
    '/* document.createElement("style") */',
    'export const ok = 1;',
  ].join('\n');
  assert.deepEqual(scanSource(src), { cssInjection: 0, inlineStyles: 0 });
});

function tree(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'fgs-ui-lint-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, body] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

test('scanSurface totals source files and skips tests and node_modules', (t) => {
  const root = tree(t, {
    'packages/games-sdk/src/A.tsx': 'export const A = () => <div style={{ a: 1 }} />;',
    'packages/games-sdk/src/A.test.tsx': 'export const T = () => <div style={{ a: 1 }} />;',
    'packages/games-sdk/src/node_modules/x/B.tsx': '<div style={{ a: 1 }} />',
    'packages/games-sdk/src/C.tsx': 'export const C = () => <style>{CSS}</style>;',
  });
  const { totals, files } = scanSurface('packages/games-sdk/src', root);
  assert.deepEqual(totals, { cssInjection: 1, inlineStyles: 1 });
  assert.deepEqual(files.map((f) => f.file).sort(), [
    'packages/games-sdk/src/A.tsx',
    'packages/games-sdk/src/C.tsx',
  ]);
});

test('evaluate fails only when a count rises above the baseline', () => {
  const baseline = { s: { cssInjection: 2, inlineStyles: 10 } };
  const same = evaluate({ s: { cssInjection: 2, inlineStyles: 10 } }, baseline);
  assert.deepEqual(same.regressions, []);

  const worse = evaluate({ s: { cssInjection: 3, inlineStyles: 10 } }, baseline);
  assert.deepEqual(worse.regressions, [
    { surface: 's', metric: 'cssInjection', now: 3, allowed: 2 },
  ]);

  const better = evaluate({ s: { cssInjection: 2, inlineStyles: 4 } }, baseline);
  assert.deepEqual(better.regressions, []);
  assert.deepEqual(better.improvements, [
    { surface: 's', metric: 'inlineStyles', now: 4, allowed: 10 },
  ]);
});

test('evaluate --strict fails on any non-zero count even at baseline', () => {
  const baseline = { s: { cssInjection: 1, inlineStyles: 1 } };
  const strict = evaluate({ s: { cssInjection: 1, inlineStyles: 0 } }, baseline, { strict: true });
  assert.deepEqual(strict.regressions, []);
  assert.deepEqual(strict.strictFailures, [{ surface: 's', metric: 'cssInjection', now: 1 }]);
  assert.equal(
    evaluate({ s: { cssInjection: 0, inlineStyles: 0 } }, baseline, { strict: true }).strictFailures
      .length,
    0,
  );
});

test('run reports ok at baseline and not ok when a surface regresses', (t) => {
  const root = tree(t, {
    'packages/games-sdk/src/A.tsx': 'export const A = () => <div style={{ a: 1 }} />;',
    'apps/console/web/src/B.tsx': 'export const B = () => <div />;',
    'apps/admin/web/src/C.tsx': 'export const C = () => <div />;',
  });
  const baseline = { 'packages/games-sdk/src': { cssInjection: 0, inlineStyles: 1 } };
  assert.equal(run({ root, baseline }).ok, true);
  assert.equal(
    run({ root, baseline: { 'packages/games-sdk/src': { cssInjection: 0, inlineStyles: 0 } } }).ok,
    false,
  );
});

test('the committed baseline covers every surface and the repo is at or below it', () => {
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  assert.deepEqual(Object.keys(baseline).sort(), [...SURFACES].sort());
  const result = run({ baseline });
  assert.deepEqual(result.regressions, []);
  assert.equal(result.ok, true);
});

test('run --strict fails while any inline style or injected CSS remains', (t) => {
  const root = tree(t, {
    'packages/games-sdk/src/A.tsx': 'export const A = () => <div style={{ a: 1 }} />;',
    'apps/console/web/src/B.tsx': 'export const B = () => <div />;',
    'apps/admin/web/src/C.tsx': 'export const C = () => <div />;',
  });
  const baseline = { 'packages/games-sdk/src': { cssInjection: 0, inlineStyles: 1 } };
  assert.equal(run({ root, baseline }).ok, true, 'at baseline the ratchet passes');
  const strict = run({ root, baseline, strict: true });
  assert.equal(strict.ok, false);
  assert.deepEqual(strict.strictFailures, [
    { surface: 'packages/games-sdk/src', metric: 'inlineStyles', now: 1 },
  ]);
});

test('CLI exits 0 at baseline, and with --strict now that every surface is migrated', () => {
  // The platform UI epic (#390) is done for games-sdk, console and admin: all three are at 0.
  const script = join(dirname(fileURLToPath(import.meta.url)), 'lint-platform-ui.mjs');
  const normal = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(normal.status, 0, normal.stderr);
  assert.match(normal.stdout, /packages\/games-sdk\/src: runtime CSS injection/);
  const strict = spawnSync(process.execPath, [script, '--strict'], { encoding: 'utf8' });
  assert.equal(strict.status, 0, strict.stderr);
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  for (const surface of SURFACES) {
    assert.deepEqual(baseline[surface], { cssInjection: 0, inlineStyles: 0 }, surface);
  }
});
