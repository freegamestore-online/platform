import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameAnalytics } from './GameAnalytics';

type FetchCall = [string, RequestInit | undefined];
/** The recorded fetch calls, typed as [url, init]. */
const fetchCalls = (mock: unknown) =>
  (mock as { mock: { calls: unknown[] } }).mock.calls as FetchCall[];

// #354: the owner's panel. Shows the stats, the custom-event filter, and a 503
// as a setup message rather than a broken chart.

const STATS = {
  appId: 'chess',
  days: 7,
  kind: 'pageview',
  bucket: 'day',
  path: null,
  config: { ga4: 'G-ABC123', plausible: null },
  stats: {
    total_views: 1234,
    unique_paths: 3,
    series: [{ t: '2026-10-17', views: 1234 }],
    top_paths: [{ path: '/', views: 1000 }],
    top_referrers: [],
    top_countries: [{ country: 'GB', views: 900 }],
    device_split: [{ device: 'desktop', views: 1100 }],
    events: [{ kind: 'level_won', count: 42 }],
  },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('GameAnalytics panel (#354)', () => {
  it('shows the owner stats, the saved tag and the custom events', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(STATS), { status: 200 })),
    );
    render(<GameAnalytics gameId="chess" />);

    expect(await screen.findByTestId('total-views')).toHaveTextContent('1,234');
    expect(screen.getByDisplayValue('G-ABC123')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /pageview over the last 7 days/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /level_won/ })).toBeInTheDocument();
    expect(screen.getByText('No data yet.', { exact: false })).toBeInTheDocument();
  });

  it('explains a 503 as a setup state, not a generic failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'stats not configured' }), { status: 503 }),
      ),
    );
    render(<GameAnalytics gameId="chess" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('not set up on this environment');
  });

  it('shows the server message for a non-owner', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ error: 'not the game owner' }), { status: 403 }),
      ),
    );
    render(<GameAnalytics gameId="chess" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('not the game owner');
  });

  it('refetches with the custom event kind when an event is selected', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(STATS), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<GameAnalytics gameId="chess" />);
    fireEvent.click(await screen.findByRole('button', { name: /level_won/ }));
    await waitFor(() =>
      expect(fetchCalls(fetchMock).map((c) => c[0])).toContain(
        '/api/analytics/chess?days=7&kind=level_won',
      ),
    );
  });

  it('saves the tags with a PUT and confirms the save', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: { method?: string }) => {
      if (init?.method === 'PUT') {
        return new Response(
          JSON.stringify({ ok: true, config: { ga4: 'G-ZZZ999', plausible: null } }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify(STATS), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<GameAnalytics gameId="chess" />);

    const input = await screen.findByDisplayValue('G-ABC123');
    fireEvent.change(input, { target: { value: 'G-ZZZ999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save tags' }));

    expect(await screen.findByText(/Saved\./)).toBeInTheDocument();
    const put = fetchCalls(fetchMock).find((c) => c[1]?.method === 'PUT');
    expect(JSON.parse(put![1]!.body as string)).toEqual({ ga4: 'G-ZZZ999', plausible: null });
  });
});

// #364: when the numbers can't load, the API still answers 200 with the saved
// tags. The panel says why and keeps the tag form usable, seeded with them.
describe('GameAnalytics panel without stats (#364)', () => {
  const NO_STATS = {
    ...STATS,
    config: { ga4: 'G-ABC123', plausible: 'chess.freegamestore.online' },
    stats: null,
    statsUnavailable: 'not-configured',
  };

  it('explains the missing numbers and shows the saved tags', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(NO_STATS), { status: 200 })),
    );
    render(<GameAnalytics gameId="chess" />);

    expect(await screen.findByRole('status')).toHaveTextContent(
      'aren’t switched on for this environment yet',
    );
    expect(screen.getByDisplayValue('G-ABC123')).toBeInTheDocument();
    expect(screen.getByDisplayValue('chess.freegamestore.online')).toBeInTheDocument();
    expect(screen.queryByTestId('total-views')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says the numbers are temporarily unavailable when the query failed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ...NO_STATS, statsUnavailable: 'unavailable' }), {
            status: 200,
          }),
      ),
    );
    render(<GameAnalytics gameId="chess" />);
    expect(await screen.findByRole('status')).toHaveTextContent('couldn’t be loaded right now');
  });

  it('saving keeps both saved tags instead of clearing them', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: { method?: string }) => {
      if (init?.method === 'PUT') {
        return new Response(JSON.stringify({ ok: true, config: NO_STATS.config }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify(NO_STATS), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<GameAnalytics gameId="chess" />);

    await screen.findByDisplayValue('G-ABC123');
    fireEvent.click(screen.getByRole('button', { name: 'Save tags' }));
    expect(await screen.findByText(/Saved\./)).toBeInTheDocument();
    const put = fetchCalls(fetchMock).find((c) => c[1]?.method === 'PUT');
    expect(JSON.parse(put![1]!.body as string)).toEqual({
      ga4: 'G-ABC123',
      plausible: 'chess.freegamestore.online',
    });
  });
});
