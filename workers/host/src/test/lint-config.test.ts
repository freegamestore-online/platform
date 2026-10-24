import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('lints host source and rejects invalid code rather than ignoring the worker tree', () => {
  const probe = fileURLToPath(new URL(`lint-probe-${randomUUID()}.ts`, import.meta.url));
  const run = () => spawnSync('pnpm', ['lint'], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    encoding: 'utf8',
    timeout: 10_000,
  });
  try {
    writeFileSync(probe, 'const value = 1; console.log(value);\n');
    const good = run();
    expect(good.error).toBeUndefined();
    expect(good.status, good.stdout + good.stderr).toBe(0);
    expect(good.stdout + good.stderr).toMatch(/Checked [1-9]\d* files?/);
    writeFileSync(probe, 'const value = 1; value = 2; console.log(value);\n');
    const bad = run();
    expect(bad.error).toBeUndefined();
    expect(bad.status).not.toBe(0);
    expect(bad.stdout + bad.stderr).toContain('noConstAssign');
  } finally {
    unlinkSync(probe);
  }
}, 30_000);
