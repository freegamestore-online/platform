import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { type CheckResult, runChecks } from '@freegamestore/compliance';
import { Command } from 'commander';
import { bold, dim, green, red, yellow } from '../lib/style.js';

/**
 * Find the game's repo root by walking up from `start` looking for the
 * marker files every scaffolded game has at root. Returns `start` if no
 * marker is found (so `--dir` can still target an arbitrary directory).
 *
 * Why: `pnpm build` runs the prebuild hook with cwd=`web/`, but the
 * compliance checks expect to find `LICENSE`, `web/index.html`, etc.
 * relative to the repo root. Walking up makes `fgs check` work from
 * either the root or a `web/` subdir without callers having to pass
 * `--dir ..`.
 */
function findGameRoot(start: string): string {
  let dir = resolve(start);
  const stop = '/';
  while (dir !== stop) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml')) || existsSync(resolve(dir, 'LICENSE'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(start);
}

const ICON: Record<CheckResult['status'], string> = {
  pass: '✓',
  warn: '!',
  fail: '✗',
};

const COLOR: Record<CheckResult['status'], (s: string) => string> = {
  pass: green,
  warn: yellow,
  fail: red,
};

export interface CheckSummary {
  failed: number;
  warned: number;
  passed: number;
}

/**
 * Print compliance results in the standard format. Reused by `fgs check`
 * and by `fas publish`'s pre-flight gate so output stays identical.
 */
export function renderCheckResults(results: CheckResult[]): CheckSummary {
  let failed = 0;
  let warned = 0;
  let passed = 0;
  for (const r of results) {
    const icon = COLOR[r.status](ICON[r.status]);
    process.stdout.write(`${icon}  ${bold(r.name.padEnd(28))} ${dim(r.detail)}\n`);
    if (r.suggestions && r.suggestions.length > 0 && r.status !== 'pass') {
      for (const s of r.suggestions) {
        process.stdout.write(`     ${dim('→')} ${dim(s)}\n`);
      }
    }
    if (r.status === 'fail') failed++;
    else if (r.status === 'warn') warned++;
    else passed++;
  }

  process.stdout.write('\n');
  if (failed > 0) {
    process.stdout.write(red(`✗ ${failed} failed`));
  } else {
    process.stdout.write(green(`✓ all hard checks passed`));
  }
  if (warned > 0) {
    process.stdout.write(yellow(`, ${warned} warning${warned === 1 ? '' : 's'}`));
  }
  process.stdout.write('\n');

  return { failed, warned, passed };
}

export const checkCommand = new Command('check')
  .description('Run FreeGameStore compliance checks against the current directory.')
  .option('--dir <path>', 'Directory to check', process.cwd())
  .action(async (opts: { dir: string }) => {
    const root = findGameRoot(opts.dir);
    const results = await runChecks(root);
    const { failed } = renderCheckResults(results);
    if (failed > 0) process.exit(1);
  });
