import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyDist } from '../scripts/verify-dist.mjs';

test('deployment rejects absent docs and missing docs assets', () => {
  const dist = mkdtempSync(join(tmpdir(), 'fgs-deploy-'));
  const put = (file, content = '') => {
    const path = join(dist, file);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
  };
  try {
    for (const file of ['index.html', 'style.css', '_headers', '_redirects']) put(file);
    assert.throws(() => verifyDist(dist), /docs\/index.html/);
    put('docs/index.html', '<link href="/docs/_astro/main.css" rel="stylesheet">');
    put('docs/sdk/overview/index.html');
    assert.throws(() => verifyDist(dist), /Missing docs asset/);
    put('docs/_astro/main.css', 'body{}');
    assert.doesNotThrow(() => verifyDist(dist));
    put('docs/index.html', '<html>unbuilt docs</html>');
    assert.throws(() => verifyDist(dist), /no built CSS\/JS/);
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

test('production workflow gates upload on storefront tests and combined SDK docs build', () => {
  const workflow = readFileSync(new URL('../../../.github/workflows/deploy-storefront.yml', import.meta.url), 'utf8');
  const commands = ['npm test', 'npm run build', 'pnpm --dir docs install --frozen-lockfile --ignore-workspace',
    'npm --prefix docs run build', 'node scripts/verify-dist.mjs', 'npx wrangler pages deploy dist'];
  let previous = -1;
  for (const command of commands) {
    const position = workflow.indexOf(`run: ${command}`);
    assert.ok(position > previous, `${command} must run in order before deployment`);
    previous = position;
  }
  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /if: github.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /sites\/freegamestore\/\*\*/);
  assert.match(workflow, /--project-name=freegamestore --branch=main --commit-hash=\$\{\{ github.sha \}\}/);
  assert.doesNotMatch(workflow, /continue-on-error:/);
});
