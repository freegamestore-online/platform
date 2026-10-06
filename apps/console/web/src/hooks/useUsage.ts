import { useEffect, useState } from 'react';
import { useSharedSessions } from '../lib/agentClient';
import type { UsageTotals } from '../lib/sessions';
import { useAuth } from './useAuth';

// Account token usage. Reads the SAME agent `/sessions` index the draft list and
// picker use — it now returns each session's cumulative token totals plus an
// account-wide `totals` sum — so this is a zero-extra-cost read (no new endpoint,
// no DO wake). Per-game rows let a creator see which game cost what; the total is
// the whole account. Non-fatal: usage is an informational surface, never blocks.

export interface UsageGame {
  id: string;
  name: string;
  gameId?: string;
  input: number;
  output: number;
}

export function useUsage() {
  const { user } = useAuth();
  const cacheData = useSharedSessions([user?.sub]);
  const [totals, setTotals] = useState<UsageTotals | null>(null);
  const [games, setGames] = useState<UsageGame[]>([]);
  const [loading, setLoading] = useState(!user);

  // Update usage whenever sessions change
  useEffect(() => {
    if (!user) {
      setTotals(null);
      setGames([]);
      setLoading(false);
      return;
    }
    setTotals(cacheData.totals ?? null);
    setGames(
      cacheData.sessions
        .map((s) => ({
          id: s.id,
          name: s.name || 'Untitled',
          gameId: s.gameId,
          input: s.tokens?.input ?? 0,
          output: s.tokens?.output ?? 0,
        }))
        .filter((g) => g.input + g.output > 0)
        .sort((a, b) => b.input + b.output - (a.input + a.output)),
    );
  }, [cacheData.sessions, cacheData.totals, user]);

  return { totals, games, loading };
}
