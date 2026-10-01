import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeApiBase } from './config.js';

describe('normalizeApiBase', () => {
  it('leaves a clean URL alone', () => {
    expect(normalizeApiBase('https://api.freegamestore.online')).toBe(
      'https://api.freegamestore.online',
    );
  });

  it('strips a single trailing slash (regression: //health URLs)', () => {
    expect(normalizeApiBase('https://api.freegamestore.online/')).toBe(
      'https://api.freegamestore.online',
    );
  });

  it('strips multiple trailing slashes', () => {
    expect(normalizeApiBase('https://api.freegamestore.online////')).toBe(
      'https://api.freegamestore.online',
    );
  });

  it('preserves path segments and only strips the rightmost slashes', () => {
    expect(normalizeApiBase('https://api.example.com/v1/')).toBe('https://api.example.com/v1');
    expect(normalizeApiBase('https://api.example.com/v1//')).toBe('https://api.example.com/v1');
  });

  it('handles localhost dev URLs', () => {
    expect(normalizeApiBase('http://localhost:8787/')).toBe('http://localhost:8787');
    expect(normalizeApiBase('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787');
  });
});

// #98: `fgs login` persisted apiBase and readConfig spread the file over the
// env-derived default, so FGS_API_BASE at login pinned that base for good.
describe('API base precedence (#98)', () => {
  const PROD = 'https://admin.freegamestore.online';
  const STAGING = 'https://admin-staging.example.com';
  let home: string;
  const saved = { HOME: process.env.HOME, FGS_API_BASE: process.env.FGS_API_BASE };

  async function load() {
    vi.resetModules(); // CONFIG_FILE is derived from HOME at import time
    return import('./config.js');
  }

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'fgs-home-'));
    process.env.HOME = home;
    delete process.env.FGS_API_BASE;
  });
  afterEach(async () => {
    process.env.HOME = saved.HOME;
    if (saved.FGS_API_BASE === undefined) delete process.env.FGS_API_BASE;
    else process.env.FGS_API_BASE = saved.FGS_API_BASE;
    await rm(home, { recursive: true, force: true });
  });

  const persist = async (data: unknown) => {
    await mkdir(join(home, '.fgs'), { recursive: true });
    await writeFile(join(home, '.fgs', 'config.json'), JSON.stringify(data));
  };

  it('FGS_API_BASE wins over a base persisted by an earlier login', async () => {
    await persist({ apiBase: STAGING, session: { token: 't', obtainedAt: 1 } });
    process.env.FGS_API_BASE = PROD;
    const { readConfig } = await load();
    const config = await readConfig();
    expect(config.apiBase).toBe(PROD);
    expect(config.session?.token).toBe('t'); // the rest of the file still loads
  });

  it('honours FGS_API_BASE set after the module was loaded', async () => {
    const { readConfig } = await load();
    process.env.FGS_API_BASE = `${STAGING}/`;
    expect((await readConfig()).apiBase).toBe(STAGING);
  });

  it('ignores a stale persisted base when FGS_API_BASE is unset', async () => {
    await persist({ apiBase: 'https://api.freegamestore.online' });
    const { readConfig } = await load();
    expect((await readConfig()).apiBase).toBe(PROD);
  });

  it('login no longer persists the API base', async () => {
    process.env.FGS_API_BASE = STAGING;
    const { readConfig, writeConfig, CONFIG_FILE } = await load();
    await writeConfig({ ...(await readConfig()), session: { token: 't', obtainedAt: 1 } });
    const onDisk = JSON.parse(await readFile(CONFIG_FILE, 'utf8')) as Record<string, unknown>;
    expect(onDisk).not.toHaveProperty('apiBase');
    expect(onDisk.session).toEqual({ token: 't', obtainedAt: 1 });
  });
});
