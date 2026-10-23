import { afterEach, describe, expect, it, vi } from 'vitest';
import { __clearRouteCache, securityHeaders } from '../host';
import { publicGame } from '../seo';
import worker from '../index';

vi.mock('../seo', async (original) => ({
  ...await original<typeof import('../seo')>(),
  publicGame: vi.fn(),
}));

afterEach(() => { vi.resetAllMocks(); __clearRouteCache(); });
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
const route = { slug: 'threaded', zone: 'freegamestore.online', r2_prefix: 'games/threaded', store: 'games' };

async function hit(path: string, init: RequestInit = {}, outage = false) {
  const obj = { body: 'game', httpEtag: '"v1"', size: 4, range: { offset: 0, length: 2 } };
  const env = {
    DB: { prepare: () => ({ bind: () => ({ first: async () => route }) }) },
    APPS: {
      get: async (key: string) => {
        if (outage) throw new Error('R2 unavailable');
        return key.endsWith('missing.png') ? null : obj;
      },
      head: async () => obj,
    },
  };
  return worker.fetch(new Request('https://threaded.freegamestore.online' + path, init), env as never, ctx);
}

describe('registry cross-origin isolation opt-in (#371)', () => {
  it.each([undefined, false, 'true', 1])('does not add isolation headers for %s', async (value) => {
    vi.mocked(publicGame).mockResolvedValue({ crossOriginIsolated: value } as never);
    const response = await hit('/game.wasm');
    expect(response.status).toBe(200);
    expect(response.headers.has('cross-origin-opener-policy')).toBe(false);
    expect(response.headers.has('cross-origin-embedder-policy')).toBe(false);
  });

  it.each([
    ['/', {}, 200],
    ['/index.html', { method: 'HEAD' }, 200],
    ['/game.wasm', {}, 200],
    ['/worker.js', {}, 200],
    ['/level/one', {}, 200],
    ['/game.wasm', { headers: { 'if-none-match': '"v1"' } }, 304],
    ['/game.wasm', { headers: { range: 'bytes=0-1' } }, 206],
    ['/missing.png', {}, 404],
    ['/', { method: 'POST' }, 405],
    ['/version.json', {}, 200],
    ['/robots.txt', {}, 200],
    ['/sitemap.xml', {}, 200],
  ])('applies headers consistently to %s (%s)', async (path, init, status) => {
    vi.mocked(publicGame).mockResolvedValue({ crossOriginIsolated: true });
    const response = await hit(path as string, init as RequestInit);
    expect(response.status).toBe(status);
    expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(response.headers.get('cross-origin-embedder-policy')).toBe('credentialless');
    expect(response.headers.get('permissions-policy')).toContain('payment=()');
  });

  it('preserves the opt-in headers on an R2 outage', async () => {
    vi.mocked(publicGame).mockResolvedValue({ crossOriginIsolated: true });
    const response = await hit('/game.wasm', {}, true);
    expect(response.status).toBe(503);
    expect(response.headers.get('cross-origin-embedder-policy')).toBe('credentialless');
  });

  it('supports both security-header modes without tightening default CSP', () => {
    const standard = securityHeaders({ revalidate: true });
    const isolated = securityHeaders({ revalidate: true, crossOriginIsolated: true });
    expect(standard.has('cross-origin-opener-policy')).toBe(false);
    expect(standard.has('cross-origin-embedder-policy')).toBe(false);
    expect(isolated.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(isolated.get('cross-origin-embedder-policy')).toBe('credentialless');
    expect(isolated.get('content-security-policy')).toBe(standard.get('content-security-policy'));
  });
});
