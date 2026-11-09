import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'fgs-login-test-'));
  vi.stubEnv('HOME', home);
  vi.resetModules();
  await mkdir(join(home, '.fgs'));
  await writeFile(
    join(home, '.fgs', 'config.json'),
    JSON.stringify({
      github: { login: 'test-user', obtainedAt: 1 },
      session: { token: 'dummy-session-token', obtainedAt: 1 },
    }),
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

describe('login API transport guard (#535)', () => {
  it.each(['http://admin.example.com', 'not-a-url', 'ftp://localhost'])(
    'refuses an invalid override before any network call, even with a cached session: %s',
    async (value) => {
      vi.stubEnv('FGS_API_BASE', value);
      const fetch = vi.fn().mockRejectedValue(new Error('network must not run'));
      vi.stubGlobal('fetch', fetch);
      const { runLogin } = await import('./login.js');
      await expect(runLogin()).rejects.toThrow(/FGS_API_BASE.*https/i);
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});
