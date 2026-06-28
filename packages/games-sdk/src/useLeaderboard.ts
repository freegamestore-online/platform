import { useCallback, useEffect, useRef, useState } from 'react';

// Versioned endpoint (additive-only contract — see platform/docs/API-CONTRACT.md).
// The worker also serves the unversioned paths, so games built against older
// SDK releases keep working.
const API_BASE = 'https://leaderboard.freegamestore.online/v1';

export interface LeaderboardEntry {
  player_name: string;
  score: number;
  user_id?: string;
  avatar_url?: string;
  created_at: string;
}

// Wire shape returned by the leaderboard Worker for both /api/leaderboard/:game
// and /api/leaderboard/:game/recent — the row data lives under `.scores`.
interface LeaderboardResponse {
  game: string;
  scores: LeaderboardEntry[];
}

// POST /api/scores response — the rank lookup runs against signed-in
// users only, so an anonymous submit returns `authenticated: false`
// with no rank.
interface SubmitScoreResponse {
  ok?: boolean;
  rank?: number;
  authenticated?: boolean;
  error?: string;
}

export function useLeaderboard(gameId: string): {
  topScores: LeaderboardEntry[];
  recentScores: LeaderboardEntry[];
  submitScore: (score: number) => Promise<{ ok: boolean; rank?: number }>;
  loading: boolean;
  refresh: () => void;
} {
  const [topScores, setTopScores] = useState<LeaderboardEntry[]>([]);
  const [recentScores, setRecentScores] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  // Guards against setState after unmount. load() is called both from the
  // mount effect and from submitScore(); a ref covers every caller, unlike a
  // per-effect cancelled flag.
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const load = useCallback(() => {
    setLoading(true);
    // Fire-and-forget: inner fetches each .catch() to [], so this never
    // rejects; `void` marks the intentional non-await.
    void Promise.all([
      fetch(`${API_BASE}/api/leaderboard/${gameId}?limit=50`, { credentials: 'include' })
        .then(async (r) => {
          if (!r.ok) return [] as LeaderboardEntry[];
          const data = (await r.json()) as LeaderboardResponse;
          return data.scores ?? [];
        })
        .catch(() => [] as LeaderboardEntry[]),
      fetch(`${API_BASE}/api/leaderboard/${gameId}/recent?limit=50`, {
        credentials: 'include',
      })
        .then(async (r) => {
          if (!r.ok) return [] as LeaderboardEntry[];
          const data = (await r.json()) as LeaderboardResponse;
          return data.scores ?? [];
        })
        .catch(() => [] as LeaderboardEntry[]),
    ]).then(([top, recent]) => {
      if (!mountedRef.current) return;
      setTopScores(top);
      setRecentScores(recent);
      setLoading(false);
    });
  }, [gameId]);

  useEffect(() => {
    load();
  }, [load]);

  const submitScore = useCallback(
    async (score: number): Promise<{ ok: boolean; rank?: number }> => {
      try {
        // The Worker wants `{ game, score }` (and an optional `name` if not
        // signed in; signed-in users get their name from the cookie JWT).
        const res = await fetch(`${API_BASE}/api/scores`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ game: gameId, score }),
        });
        if (!res.ok) return { ok: false };
        const data = (await res.json()) as SubmitScoreResponse;
        // Refresh scores after submission
        load();
        const result: { ok: boolean; rank?: number } = { ok: data.ok !== false };
        if (data.rank !== undefined) result.rank = data.rank;
        return result;
      } catch {
        return { ok: false };
      }
    },
    [gameId, load],
  );

  return { topScores, recentScores, submitScore, loading, refresh: load };
}
