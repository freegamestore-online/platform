// Regression guard for deploy-mcp.yml's install context (#147). workers/mcp
// depends on the workspace package @freegamestore/contracts via `workspace:*`,
// which only resolves when installing from the repo root with pnpm. An
// `npm ci` or a job-level working-directory of workers/mcp breaks the install,
// so this asserts the workflow installs the way packages-ci.yml does.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const workflow = await readFile(resolve(repoRoot, '.github/workflows/deploy-mcp.yml'), 'utf8');

test('deploy-mcp never uses npm to install', () => {
  assert.doesNotMatch(workflow, /\bnpm (ci|install|i)\b/);
  assert.doesNotMatch(workflow, /package-lock\.json/);
});

test('deploy-mcp installs with pnpm from the repo root against pnpm-lock.yaml', () => {
  assert.match(workflow, /cache-dependency-path: pnpm-lock\.yaml/);
  assert.match(workflow, /run: pnpm install --frozen-lockfile\n/);
  // A job-level `defaults.run.working-directory` would run the install in
  // workers/mcp instead of the workspace root.
  assert.doesNotMatch(workflow, /^\s{4}defaults:/m);
});

test('deploy-mcp builds contracts before typecheck and tests', () => {
  const build = workflow.indexOf('pnpm --filter @freegamestore/contracts build');
  const typecheck = workflow.indexOf('pnpm --filter freegamestore-mcp typecheck');
  assert.ok(build !== -1, 'contracts build step missing');
  assert.ok(build < typecheck, 'contracts must build before the MCP typecheck');
});
