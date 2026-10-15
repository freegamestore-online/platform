import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLeaderboard } from './useLeaderboard.js';

const entry = (name: string, score: number) => ({
  player_name: name,
  score,
  created_at: '2026-01-01',
});

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = handler(String(url), init);
    return { ok: true, json: async () => body } as Response;
  }) as unknown as typeof fetch;
}

describe('useLeaderboard', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('loads top + recent scores on mount, then stops loading', async () => {
    mockFetch((url) =>
      url.includes('/recent')
        ? { game: 'g', scores: [entry('Recent', 5)] }
        : { game: 'g', scores: [entry('Top', 100)] },
    );
    const { result } = renderHook(() => useLeaderboard('snake'));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.topScores[0]?.player_name).toBe('Top');
    expect(result.current.recentScores[0]?.player_name).toBe('Recent');
  });

  it('submitScore returns ok + rank from the worker', async () => {
    mockFetch((url) =>
      url.includes('/handoff/issue')
        ? { token: 'game-scoped-token' }
        : url.includes('/api/scores')
          ? { ok: true, rank: 3 }
          : { game: 'g', scores: [] },
    );
    const { result } = renderHook(() => useLeaderboard('snake'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let out: { ok: boolean; rank?: number } = { ok: false };
    await act(async () => {
      out = await result.current.submitScore(42);
    });
    expect(out).toEqual({ ok: true, rank: 3 });
    const scoreCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(([url]) =>
      String(url).includes('/api/scores'),
    );
    expect(scoreCall?.[1]?.headers).toMatchObject({ Authorization: 'Bearer game-scoped-token' });
  });

  it('submitScore returns {ok:false} on a rejected (e.g. 401) response', async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) =>
      String(url).includes('/api/scores')
        ? ({ ok: false, json: async () => ({}) } as Response)
        : ({ ok: true, json: async () => ({ game: 'g', scores: [] }) } as Response),
    ) as unknown as typeof fetch;
    const { result } = renderHook(() => useLeaderboard('snake'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let out: { ok: boolean } = { ok: true };
    await act(async () => {
      out = await result.current.submitScore(42);
    });
    expect(out.ok).toBe(false);
  });

  it('survives a network failure without throwing (empty scores)', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network');
    }) as unknown as typeof fetch;
    const { result } = renderHook(() => useLeaderboard('snake'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.topScores).toEqual([]);
  });
});

// #161 — a per-day board. Without `period` the hook must behave exactly as the
// all-time board did: same URLs, same submit body.
describe('useLeaderboard per-day period (#161)', () => {
  const DAY1 = '2026-10-15';
  const DAY2 = '2026-10-16';

  const requestedUrls = () =>
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([url]) =>
      String(url),
    );

  /** Serves the handoff, the score POST and the two board reads. */
  function mockBoardsAndSubmit() {
    mockFetch((url) =>
      url.includes('/handoff/issue')
        ? { token: 'game-scoped-token' }
        : url.includes('/api/scores')
          ? { ok: true, rank: 1 }
          : { game: 'mosaic', scores: [] },
    );
  }

  const scoreBody = () => {
    const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      ([url]) => String(url).includes('/api/scores'),
    );
    return JSON.parse(String(call?.[1]?.body));
  };

  beforeEach(() => vi.restoreAllMocks());

  it('without a period, reads the all-time boards and submits no period', async () => {
    mockBoardsAndSubmit();
    const { result } = renderHook(() => useLeaderboard('mosaic'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const urls = requestedUrls();
    expect(urls).toContain(
      'https://leaderboard.freegamestore.online/v1/api/leaderboard/mosaic?limit=50',
    );
    expect(urls).toContain(
      'https://leaderboard.freegamestore.online/v1/api/leaderboard/mosaic/recent?limit=50',
    );
    expect(urls.some((u) => u.includes('period'))).toBe(false);

    await act(async () => {
      await result.current.submitScore(42);
    });
    expect(scoreBody()).toEqual({ game: 'mosaic', score: 42 });
  });

  it('with a period, both boards are read for that day and the submit carries it', async () => {
    mockBoardsAndSubmit();
    const { result } = renderHook(() => useLeaderboard('mosaic', { period: DAY1 }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const urls = requestedUrls();
    expect(urls).toContain(
      `https://leaderboard.freegamestore.online/v1/api/leaderboard/mosaic?limit=50&period=${DAY1}`,
    );
    expect(urls).toContain(
      `https://leaderboard.freegamestore.online/v1/api/leaderboard/mosaic/recent?limit=50&period=${DAY1}`,
    );

    await act(async () => {
      await result.current.submitScore(42);
    });
    expect(scoreBody()).toEqual({ game: 'mosaic', score: 42, period: DAY1 });
  });

  it('reloads the boards when the period changes to a new day', async () => {
    mockBoardsAndSubmit();
    const { result, rerender } = renderHook(
      ({ period }: { period: string }) => useLeaderboard('mosaic', { period }),
      { initialProps: { period: DAY1 } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    rerender({ period: DAY2 });
    await waitFor(() =>
      expect(requestedUrls()).toContain(
        `https://leaderboard.freegamestore.online/v1/api/leaderboard/mosaic?limit=50&period=${DAY2}`,
      ),
    );
  });
});
