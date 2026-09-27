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
