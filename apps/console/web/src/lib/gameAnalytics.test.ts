import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchGameAnalytics, saveGameAnalyticsConfig, seriesBars } from './gameAnalytics';

type FetchCall = [string, RequestInit | undefined];
/** The recorded fetch calls, typed as [url, init]. */
const fetchCalls = (mock: unknown) =>
  (mock as { mock: { calls: unknown[] } }).mock.calls as FetchCall[];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('seriesBars', () => {
  it('scales the tallest bar to the full height and gives zero-view days no height', () => {
    const bars = seriesBars(
      [
        { t: 'a', views: 10 },
        { t: 'b', views: 0 },
        { t: 'c', views: 5 },
      ],
      100,
      50,
    );
    expect(bars[0]).toMatchObject({ height: 50, y: 0 });
    expect(bars[1]).toMatchObject({ height: 0, y: 50 });
    expect(bars[2]!.height).toBe(25);
  });

  it('keeps a non-zero day visible even when it is tiny next to the max', () => {
    const bars = seriesBars(
      [
        { t: 'a', views: 1000 },
        { t: 'b', views: 1 },
      ],
      100,
      50,
    );
    expect(bars[1]!.height).toBeGreaterThanOrEqual(1);
  });

  it('lays bars out left to right without overlap and returns nothing for an empty series', () => {
    const bars = seriesBars(
      [
        { t: 'a', views: 1 },
        { t: 'b', views: 1 },
      ],
      100,
      50,
    );
    expect(bars[1]!.x).toBeGreaterThan(bars[0]!.x + bars[0]!.width - 1);
    expect(seriesBars([], 100, 50)).toEqual([]);
  });
});

describe('fetchGameAnalytics', () => {
  it('requests the window and omits the default pageview kind', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ appId: 'chess' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await fetchGameAnalytics('chess', { days: 30, kind: 'pageview' });
    expect(fetchCalls(fetchMock)[0]![0]).toBe('/api/analytics/chess?days=30');
  });

  it('sends a custom event kind and includes credentials', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await fetchGameAnalytics('chess', { days: 7, kind: 'level_won' });
    expect(fetchCalls(fetchMock)[0]![0]).toBe('/api/analytics/chess?days=7&kind=level_won');
    expect(fetchCalls(fetchMock)[0]![1]).toMatchObject({ credentials: 'include' });
  });

  it('maps a 403 to an error result carrying the server message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ error: 'not the game owner' }), { status: 403 }),
      ),
    );
    expect(await fetchGameAnalytics('chess', { days: 7 })).toEqual({
      ok: false,
      status: 403,
      error: 'not the game owner',
    });
  });

  it('maps a network failure to an error result instead of throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const res = await fetchGameAnalytics('chess', { days: 7 });
    expect(res.ok).toBe(false);
  });
});

describe('saveGameAnalyticsConfig', () => {
  it('PUTs the tags as JSON', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true, config: { ga4: 'G-ABC123', plausible: null } }), {
          status: 200,
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = await saveGameAnalyticsConfig('chess', { ga4: 'G-ABC123', plausible: null });
    const [url, init] = fetchCalls(fetchMock)[0]!;
    expect(url).toBe('/api/analytics/chess');
    expect(init!.method).toBe('PUT');
    expect(JSON.parse(init!.body as string)).toEqual({ ga4: 'G-ABC123', plausible: null });
    expect(res).toEqual({ ok: true, data: { ga4: 'G-ABC123', plausible: null } });
  });

  it('surfaces the server validation message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'ga4 must look like G-XXXXXXXX' }), { status: 400 }),
      ),
    );
    expect(await saveGameAnalyticsConfig('chess', { ga4: 'nope', plausible: null })).toEqual({
      ok: false,
      status: 400,
      error: 'ga4 must look like G-XXXXXXXX',
    });
  });
});
