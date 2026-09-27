import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_auth', () => ({ corsHeaders: () => ({}) }));
vi.mock('./_games', () => ({ getRegistry: vi.fn() }));

import { getRegistry } from './_games';
import { onRequestGet } from './catalog';

const mockedGetRegistry = vi.mocked(getRegistry);
type Ctx = Parameters<typeof onRequestGet>[0];

function makeCtx(): Ctx {
  return {
    request: new Request('https://console.freegamestore.online/api/catalog'),
    env: { GITHUB_TOKEN: 'token' },
  } as unknown as Ctx;
}

beforeEach(() => vi.clearAllMocks());

describe('catalog onRequestGet', () => {
  it('returns a retryable error when the registry cannot be read', async () => {
    mockedGetRegistry.mockResolvedValue(null);

    const res = await onRequestGet(makeCtx());

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: 'Game catalog is temporarily unavailable' });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('still returns an empty list for a genuinely empty registry', async () => {
    mockedGetRegistry.mockResolvedValue([]);

    const res = await onRequestGet(makeCtx());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ games: [] });
  });
});
