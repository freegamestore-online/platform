import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// #92: `fgs publish` exited 0 when the session was rejected (401) or admin
// refused the request (4xx, e.g. id taken) — the 4xx even fell through to the
// Issue form — and on success it told users to `git push upstream main` into a
// repo whose template-generated history the push could never fast-forward.

vi.mock('../lib/config.js', () => ({
  readConfig: vi.fn(async () => ({ apiBase: 'https://admin.test', session: { token: 'tok' } })),
}));
vi.mock('../lib/open.js', () => ({ openUrl: vi.fn(async () => {}) }));

import { openUrl } from '../lib/open.js';
import { provisionOutcome, publishCommand, tryAutoProvision } from './publish.js';

const INPUT = {
  name: 'space-rescue',
  category: 'Arcade',
  type: 'Standalone (no backend)',
  oneliner: 'Rescue astronauts',
  description: 'Rescue astronauts',
  repo: null,
  demo: null,
} as Parameters<typeof tryAutoProvision>[0];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('tryAutoProvision classifies admin responses (#92)', () => {
  it.each([
    [401, { error: 'unauthorized' }, 'unauthorized'],
    [
      400,
      { success: false, steps: [{ name: 'Validation', status: 'fail', detail: 'ID is reserved' }] },
      'rejected',
    ],
    [
      409,
      {
        success: false,
        conflict: true,
        steps: [{ name: 'GitHub repo', status: 'fail', detail: 'taken' }],
      },
      'rejected',
    ],
    [503, { error: 'not configured' }, 'unavailable'],
    [502, { error: 'bad gateway' }, 'unavailable'],
  ])('HTTP %i → %s', async (status, body, kind) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(status as number, body)),
    );
    expect((await tryAutoProvision(INPUT)).kind).toBe(kind);
  });

  it('surfaces the failing step detail of a rejection', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(400, {
          success: false,
          steps: [{ name: 'Validation', status: 'fail', detail: 'ID is reserved' }],
        }),
      ),
    );
    expect(await tryAutoProvision(INPUT)).toEqual({
      kind: 'rejected',
      reason: 'Validation: ID is reserved',
    });
  });

  it('treats a network error as unavailable (Issue fallback), not a crash', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('fetch failed'))),
    );
    expect(await tryAutoProvision(INPUT)).toEqual({ kind: 'unavailable', reason: 'fetch failed' });
  });

  it('reports whether the repo was just created', async () => {
    const ok = (status: string) =>
      json(200, {
        success: true,
        appUrl: 'https://space-rescue.freegamestore.online',
        repoUrl: 'https://github.com/freegamestore-online/space-rescue',
        steps: [{ name: 'GitHub repo', status }],
      });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ok('ok')),
    );
    expect(await tryAutoProvision(INPUT)).toMatchObject({ kind: 'success', created: true });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ok('skip')),
    );
    expect(await tryAutoProvision(INPUT)).toMatchObject({ kind: 'success', created: false });
  });
});

describe('provisionOutcome (#92)', () => {
  const pushed = (lines: string[]) => lines.some((l) => /git (push|remote add)/.test(l));

  it('auth failure exits 1 and prints no push instructions', () => {
    const o = provisionOutcome({ kind: 'unauthorized', reason: 'session expired' }, 'x', false);
    expect(o.exitCode).toBe(1);
    expect(pushed(o.lines)).toBe(false);
  });

  it('validation failure exits 1, shows the reason, and does not fall back to the Issue form', () => {
    const o = provisionOutcome(
      { kind: 'rejected', reason: 'Validation: ID is reserved' },
      'x',
      false,
    );
    expect(o.exitCode).toBe(1);
    expect(o.lines.join('\n')).toContain('ID is reserved');
    expect(pushed(o.lines)).toBe(false);
  });

  it('an unavailable service falls through to the Issue form', () => {
    expect(
      provisionOutcome({ kind: 'unavailable', reason: '503' }, 'x', false).exitCode,
    ).toBeNull();
  });

  it('a newly created repo gets instructions that can work (force-push over the scaffold)', () => {
    const o = provisionOutcome(
      { kind: 'success', appUrl: 'https://a', repoUrl: 'https://github.com/o/a', created: true },
      'a',
      true,
    );
    expect(o.exitCode).toBe(0);
    const text = o.lines.join('\n');
    expect(text).toContain('git push --force upstream main');
    expect(text).not.toMatch(/git push upstream main/);
    // The workflow the CLI just wrote must be committed before pushing.
    expect(text.indexOf('git commit')).toBeLessThan(text.indexOf('git push --force'));
  });

  it('an existing repo is never told to force-push', () => {
    const o = provisionOutcome(
      { kind: 'success', appUrl: 'https://a', repoUrl: 'https://github.com/o/a', created: false },
      'a',
      false,
    );
    expect(o.exitCode).toBe(0);
    expect(o.lines.join('\n')).not.toContain('--force');
  });
});

describe('fgs publish exit codes end to end (#92)', () => {
  let dir: string;
  let cwd: string;
  let out: string;
  beforeEach(() => {
    cwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), 'fgs-publish-'));
    mkdirSync(join(dir, 'web'), { recursive: true });
    writeFileSync(
      join(dir, 'web', 'package.json'),
      JSON.stringify({ dependencies: { '@freegamestore/games': '^0.16.0' } }),
    );
    process.chdir(dir);
    out = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      out += String(chunk);
      return true;
    });
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code ?? 0}`);
    }) as never);
    vi.mocked(openUrl).mockClear();
  });
  afterEach(() => {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const run = () =>
    publishCommand.parseAsync(
      [
        '--yes',
        '--skip-checks',
        '--no-open',
        '--name',
        'space-rescue',
        '--category',
        'arcade',
        '--type',
        'standalone',
        '--oneliner',
        'Rescue astronauts',
      ],
      { from: 'user' },
    );

  it('exits non-zero when the session is rejected (401)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(401, { error: 'unauthorized' })),
    );
    await expect(run()).rejects.toThrow('exit:1');
    expect(out).toContain('fgs login');
    expect(out).not.toMatch(/git push/);
  });

  it('exits non-zero on a validation rejection and does not open the Issue fallback', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(400, {
          success: false,
          steps: [{ name: 'Validation', status: 'fail', detail: 'ID is reserved' }],
        }),
      ),
    );
    await expect(run()).rejects.toThrow('exit:1');
    expect(out).toContain('ID is reserved');
    expect(out).not.toMatch(/git push|github\.com\/.*issues\/new/);
    expect(openUrl).not.toHaveBeenCalled();
  });

  it('exits non-zero when the id belongs to another creator (409)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(409, {
          success: false,
          conflict: true,
          steps: [
            {
              name: 'GitHub repo',
              status: 'fail',
              detail: '"space-rescue" is already taken by another creator',
            },
          ],
        }),
      ),
    );
    await expect(run()).rejects.toThrow('exit:1');
    expect(out).toContain('already taken');
  });
});
