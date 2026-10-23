import { afterEach, describe, expect, it, vi } from 'vitest';

const route = { slug: 'game', zone: 'freegamestore.online', r2_prefix: 'games/game', store: 'games' };
const game = { id: 'game', name: 'Game', description: 'Play', appUrl: 'https://game.freegamestore.online' };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('public metadata authority failure handling', () => {
  it.each(['network', 'http', 'json', 'shape'])('fails closed on %s failure', async (failure) => {
    vi.resetModules();
    vi.stubGlobal('fetch', async () => {
      if (failure === 'network') throw new Error('offline');
      if (failure === 'http') return new Response('', { status: 503 });
      if (failure === 'json') return new Response('not JSON');
      return Response.json({ games: 'invalid' });
    });
    const { publicGame } = await import('../seo');
    expect(await publicGame(route)).toBeUndefined();
  });
  it('does not reuse stale approvals after registry failure or URL mismatch', async () => {
    vi.resetModules();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ games: [null, game] }))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(Response.json({ games: [{ ...game, appUrl: 'https://other.freegamestore.online' }] }));
    vi.stubGlobal('fetch', fetcher);
    const { publicGame } = await import('../seo');
    expect(await publicGame(route)).toEqual(game);
    expect(await publicGame(route)).toEqual(game);
    expect(fetcher).toHaveBeenCalledTimes(1);
    now.mockReturnValue(62_000);
    expect(await publicGame(route)).toBeUndefined();
    expect(await publicGame(route)).toBeUndefined();
  });
});
