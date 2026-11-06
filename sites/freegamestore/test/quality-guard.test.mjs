// #442: the storefront's game previews are sandboxed (no top navigation), and the
// quality dashboard believes a postMessage only if it comes from one of its own
// iframes, from that game's origin.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

const here = (p) => new URL(`../${p}`, import.meta.url);
const quality = readFileSync(here('quality.js'), 'utf8');
const guard = /\/\/ <report-guard>([\s\S]*?)\/\/ <\/report-guard>/.exec(quality)?.[1];
assert.ok(guard, 'quality.js lost its <report-guard> block');
const acceptQualityReport = runInNewContext(`${guard}; acceptQualityReport`);

test('every iframe in the storefront templates and quality.js is sandboxed without top navigation', () => {
  const files = ['quality.js', ...readdirSync(here('templates')).map((f) => `templates/${f}`)].filter((f) =>
    /\.(html|js)$/.test(f),
  );
  let seen = 0;
  for (const f of files) {
    for (const [tag] of readFileSync(here(f), 'utf8').matchAll(/<iframe\b[^>]*>/g)) {
      seen++;
      const sandbox = /\bsandbox="([^"]*)"/.exec(tag)?.[1];
      assert.ok(sandbox !== undefined, `${f}: iframe has no sandbox: ${tag.slice(0, 80)}`);
      assert.doesNotMatch(sandbox, /allow-top-navigation/, `${f} allows top navigation`);
    }
  }
  assert.ok(seen >= 3, `expected to find the preview iframes, found ${seen}`);
});

const ORIGIN = 'https://tetris.freegamestore.online';
const win = () => ({});
const report = (extra = {}) => ({
  type: 'fgs:quality',
  viewport: { width: 1, height: 1 },
  document: { scrollWidth: 320, clientWidth: 320, scrollHeight: 568, clientHeight: 568 },
  clipping: [],
  ...extra,
});

test('a report from one of our iframes, from the game origin, is accepted for THAT frame', () => {
  const a = { contentWindow: win(), dataset: { vp: 'p-320' } };
  const b = { contentWindow: win(), dataset: { vp: 'p-360' } };
  const got = acceptQualityReport({ data: report(), origin: ORIGIN, source: b.contentWindow }, [a, b], ORIGIN);
  assert.equal(got.vpId, 'p-360', 'viewport comes from the sending frame, not the claimed numbers');
});

test('a message from another window, another origin or the wrong type is ignored', () => {
  const a = { contentWindow: win(), dataset: { vp: 'p-320' } };
  const ok = { data: report(), origin: ORIGIN, source: a.contentWindow };
  assert.ok(acceptQualityReport(ok, [a], ORIGIN));
  assert.equal(acceptQualityReport({ ...ok, source: win() }, [a], ORIGIN), null, 'not our frame');
  assert.equal(acceptQualityReport({ ...ok, source: null }, [a], ORIGIN), null);
  assert.equal(acceptQualityReport({ ...ok, origin: 'https://evil.freegamestore.online' }, [a], ORIGIN), null);
  assert.equal(acceptQualityReport({ ...ok, origin: 'null' }, [a], ORIGIN), null);
  assert.equal(acceptQualityReport({ ...ok, data: report({ type: 'other' }) }, [a], ORIGIN), null);
  assert.equal(acceptQualityReport({ ...ok, data: 'fgs:quality' }, [a], ORIGIN), null);
  assert.equal(acceptQualityReport({ ...ok, data: null }, [a], ORIGIN), null);
});

test('a report with missing or mistyped fields is ignored instead of throwing in the handler', () => {
  const a = { contentWindow: win(), dataset: { vp: 'p-320' } };
  const at = (data) => acceptQualityReport({ data, origin: ORIGIN, source: a.contentWindow }, [a], ORIGIN);
  assert.equal(at(report({ document: undefined })), null);
  assert.equal(at(report({ clipping: 'x' })), null);
  assert.equal(at(report({ document: { scrollWidth: '320' } })), null);
  assert.equal(at(report({ document: { scrollWidth: NaN, clientWidth: 1, scrollHeight: 1, clientHeight: 1 } })), null);
});

test('quality.js escapes the registry app URL it puts into an iframe src', () => {
  assert.match(quality, /src="\$\{escapeHtml\(appEntry\.appUrl\)\}"/);
});
