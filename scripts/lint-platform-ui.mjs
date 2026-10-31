#!/usr/bin/env node
/**
 * Platform-UI styling lint (platform#396, ADR-001).
 *
 * Counts, per surface, the two things the styling model forbids in the
 * platform's own React UI:
 *   - cssInjection  CSS created at runtime (a <style> element, insertRule,
 *                   adoptedStyleSheets, new CSSStyleSheet)
 *   - inlineStyles  `style={{` without a "dynamic" comment on that line or
 *                   the three above it
 *
 * The migrations (#393 games-sdk, #394 console, #395 admin) are not done, so
 * the counts are reported and ratcheted against scripts/ui-lint-baseline.json:
 * the lint fails when a count goes UP, never for the existing debt. When a
 * migration lands, run with --update-baseline to lock the lower number in.
 * Pass --strict to fail on any non-zero count (the end state of the epic).
 *
 *   node scripts/lint-platform-ui.mjs [--strict] [--update-baseline]
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const BASELINE_PATH = join(ROOT, 'scripts', 'ui-lint-baseline.json');
export const SURFACES = ['packages/games-sdk/src', 'apps/console/web/src', 'apps/admin/web/src'];
export const METRICS = ['cssInjection', 'inlineStyles'];

const SOURCE_RE = /\.(?:tsx|ts|jsx|js)$/;
const TEST_RE = /\.(?:test|spec)\.[jt]sx?$|(?:^|\/)(?:test|tests|__tests__)\//;

const INJECTION_PATTERNS = [
  /createElement\(\s*['"`]style['"`]\s*\)/g,
  /\.insertRule\s*\(/g,
  /\badoptedStyleSheets\b/g,
  /\bnew\s+CSSStyleSheet\b/g,
  /<style[\s>]/g,
];

/** Blank `/* … *\/` and `// …` comments, keeping newlines, so commented code isn't counted. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, pre) => pre + ' '.repeat(m.length - pre.length));
}

/** Count both metrics in one source file. */
export function scanSource(source) {
  const code = stripComments(source);
  let cssInjection = 0;
  for (const re of INJECTION_PATTERNS) cssInjection += (code.match(re) ?? []).length;

  const lines = source.split(/\r?\n/);
  const codeLines = code.split(/\r?\n/);
  let inlineStyles = 0;
  codeLines.forEach((line, i) => {
    const hits = line.split('style={{').length - 1;
    if (hits === 0) return;
    const context = lines.slice(Math.max(0, i - 3), i + 1).join('\n');
    if (!/dynamic/i.test(context)) inlineStyles += hits;
  });
  return { cssInjection, inlineStyles };
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist') yield* walk(full);
    } else if (SOURCE_RE.test(entry.name)) {
      yield full;
    }
  }
}

/** Totals plus the files that contribute, for one surface directory. */
export function scanSurface(dir, root = ROOT) {
  const totals = { cssInjection: 0, inlineStyles: 0 };
  const files = [];
  for (const file of walk(join(root, dir))) {
    const rel = relative(root, file).split(sep).join('/');
    if (TEST_RE.test(rel)) continue;
    const counts = scanSource(readFileSync(file, 'utf8'));
    totals.cssInjection += counts.cssInjection;
    totals.inlineStyles += counts.inlineStyles;
    if (counts.cssInjection || counts.inlineStyles) files.push({ file: rel, ...counts });
  }
  return { totals, files };
}

/**
 * Compare counts with the baseline. `regressions` fail the lint; `improvements`
 * are counts below baseline (lock them in); `strictFailures` are non-zero counts.
 */
export function evaluate(counts, baseline, { strict = false } = {}) {
  const regressions = [];
  const improvements = [];
  const strictFailures = [];
  for (const [surface, totals] of Object.entries(counts)) {
    for (const metric of METRICS) {
      const now = totals[metric];
      const allowed = baseline[surface]?.[metric] ?? 0;
      if (now > allowed) regressions.push({ surface, metric, now, allowed });
      else if (now < allowed) improvements.push({ surface, metric, now, allowed });
      if (strict && now > 0) strictFailures.push({ surface, metric, now });
    }
  }
  return { regressions, improvements, strictFailures };
}

export function run({ root = ROOT, baseline, strict = false, update = false } = {}) {
  const counts = {};
  const detail = {};
  for (const surface of SURFACES) {
    const { totals, files } = scanSurface(surface, root);
    counts[surface] = totals;
    detail[surface] = files;
  }
  if (update) {
    writeFileSync(BASELINE_PATH, `${JSON.stringify(counts, null, 2)}\n`);
    return {
      counts,
      detail,
      regressions: [],
      improvements: [],
      strictFailures: [],
      ok: true,
      updated: true,
    };
  }
  const result = evaluate(counts, baseline, { strict });
  const ok = result.regressions.length === 0 && result.strictFailures.length === 0;
  return { counts, detail, ...result, ok, updated: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = new Set(process.argv.slice(2));
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  const result = run({
    baseline,
    strict: args.has('--strict'),
    update: args.has('--update-baseline'),
  });

  console.log('Platform UI styling (ADR-001):');
  for (const [surface, totals] of Object.entries(result.counts)) {
    const allowed = baseline[surface] ?? {};
    console.log(
      `  ${surface}: runtime CSS injection ${totals.cssInjection} (baseline ${allowed.cssInjection ?? 0}), ` +
        `static inline styles ${totals.inlineStyles} (baseline ${allowed.inlineStyles ?? 0})`,
    );
  }
  if (result.updated) console.log('Baseline updated.');
  for (const r of result.improvements) {
    console.log(
      `  note: ${r.surface} ${r.metric} fell ${r.allowed} -> ${r.now}; run --update-baseline to lock it in`,
    );
  }
  for (const r of result.regressions) {
    console.error(
      `FAIL: ${r.surface} ${r.metric} rose to ${r.now} (baseline ${r.allowed}). Use Tailwind token utilities (ADR-001).`,
    );
    for (const f of result.detail[r.surface].filter((x) => x[r.metric] > 0).slice(0, 10)) {
      console.error(`    ${f.file}: ${f[r.metric]}`);
    }
  }
  for (const r of result.strictFailures) {
    console.error(`FAIL (--strict): ${r.surface} ${r.metric} = ${r.now}, expected 0`);
  }
  if (!result.ok) process.exitCode = 1;
}
