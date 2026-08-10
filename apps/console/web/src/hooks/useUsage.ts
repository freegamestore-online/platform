import { useEffect, useState } from "react";
import { useAuth } from "./useAuth";
import type { ServerSession, UsageTotals } from "../lib/sessions";

// Account token usage. Reads the SAME agent `/sessions` index the draft list and
// picker use — it now returns each session's cumulative token totals plus an
// account-wide `totals` sum — so this is a zero-extra-cost read (no new endpoint,
// no DO wake). Per-game rows let a creator see which game cost what; the total is
// the whole account. Non-fatal: usage is an informational surface, never blocks.
const AGENT_URL = "https://agent.freegamestore.online";

export interface UsageGame {
  id: string;
  name: string;
  gameId?: string;
  input: number;
  output: number;
}

export function useUsage() {
  const { user } = useAuth();
  const [totals, setTotals] = useState<UsageTotals | null>(null);
  const [games, setGames] = useState<UsageGame[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setTotals(null);
      setGames([]);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    fetch(`${AGENT_URL}/sessions`, { credentials: "include", signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { sessions?: ServerSession[]; totals?: UsageTotals }) => {
        setTotals(data.totals ?? null);
        setGames(
          (data.sessions || [])
            .map((s) => ({
              id: s.id,
              name: s.name || "Untitled",
              gameId: s.gameId,
              input: s.tokens?.input ?? 0,
              output: s.tokens?.output ?? 0,
            }))
            .filter((g) => g.input + g.output > 0)
            .sort((a, b) => b.input + b.output - (a.input + a.output)),
        );
      })
      .catch(() => {
        /* non-fatal — usage is informational */
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [user?.sub]);

  return { totals, games, loading };
}
