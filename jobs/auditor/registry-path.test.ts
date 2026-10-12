// Regression check for the registry lookup behind `audit.ts --all` (#148).
// The weekly job checks out sites/freegamestore sparsely into
// jobs/auditor/freegamestore, so registry.json lives one level deeper than the
// lookup used to expect, and the audit exited before auditing any game.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveRegistryPath } from './audit.ts';

async function touch(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, '{"games":[]}');
}

describe('resolveRegistryPath', () => {
  let root: string;
  let auditorDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'registry-path-'));
    // Mirror the monorepo layout: <root>/jobs/auditor is the auditor directory.
    auditorDir = join(root, 'jobs', 'auditor');
    await mkdir(auditorDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('finds the registry in the CI sparse checkout', async () => {
    const expected = join(auditorDir, 'freegamestore/sites/freegamestore/registry.json');
    await touch(expected);
    expect(resolveRegistryPath(auditorDir)).toBe(expected);
  });

  it('finds the registry in the local monorepo layout', async () => {
    const expected = join(root, 'sites/freegamestore/registry.json');
    await touch(expected);
    expect(resolveRegistryPath(auditorDir)).toBe(expected);
  });

  it('returns undefined when neither layout has a registry', () => {
    expect(resolveRegistryPath(auditorDir)).toBeUndefined();
  });
});
