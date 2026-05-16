import { useState, useEffect, useCallback } from 'react';

const API_BASE = 'https://freegamestore-leaderboard.serge-the-dev.workers.dev';

export interface LeaderboardEntry {
  player_name: string;
  score: number;
  user_id?: string;
  avatar_url?: string;
  created_at: string;
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

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch(`${API_BASE}/scores/${gameId}?sort=top`, { credentials: 'include' })
        .then((r) => (r.ok ? (r.json() as Promise<LeaderboardEntry[]>) : []))
        .catch(() => [] as LeaderboardEntry[]),
      fetch(`${API_BASE}/scores/${gameId}?sort=recent`, { credentials: 'include' })
        .then((r) => (r.ok ? (r.json() as Promise<LeaderboardEntry[]>) : []))
        .catch(() => [] as LeaderboardEntry[]),
    ]).then(([top, recent]) => {
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
        const res = await fetch(`${API_BASE}/scores/${gameId}`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ score }),
        });
        if (!res.ok) return { ok: false };
        const data = (await res.json()) as { rank?: number };
        // Refresh scores after submission
        load();
        const result: { ok: boolean; rank?: number } = { ok: true };
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
