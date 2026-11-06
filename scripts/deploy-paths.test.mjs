// #481: a deploy workflow must be path-triggered by every in-repo contract its
// service bundles. Otherwise a contract-only change (an ownership or reserved-id
// security fix) lands on main and no consumer redeploys.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflows = join(root, '.github/workflows');

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.wrangler'].includes(entry.name)) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|tsx|mjs|js)$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(p);
  }
  return out;
}

for (const file of readdirSync(workflows).filter((f) => /^deploy-.*\.yml$/.test(f))) {
  const yml = readFileSync(join(workflows, file), 'utf8');
  const paths = [...yml.matchAll(/^ {6}- (\S+)$/gm)].map((m) => m[1]);
  const service = paths.find((p) => /^(apps|workers)\/[^/]+\/\*\*$/.test(p));
  if (!service) continue;
  const used = new Set();
  for (const f of sourceFiles(join(root, service.replace('/**', '')))) {
    for (const m of readFileSync(f, 'utf8').matchAll(/['"](?:\.\.\/)+contracts\/([a-z0-9-]+)\//g)) {
      used.add(m[1]);
    }
  }
  test(`${file} is triggered by every contract ${service} imports`, () => {
    for (const contract of used) {
      assert.ok(
        paths.includes(`contracts/${contract}/**`),
        `${file} misses contracts/${contract}/**`,
      );
    }
  });
}
