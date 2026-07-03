import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./useAuth";

// Drafts (in-progress VibeCode sessions that haven't deployed to a live game)
// live in the agent's D1 session index, keyed by the signed-in user — the SAME
// source the studio's session picker reads. The dashboard reads it too so a game
// you're still building doesn't look lost: "My Games" shows registry (Live)
// games, this shows the rest. A session becomes a Live game (and moves to "Your
// Games") once it deploys.
const AGENT_URL = "https://agent.freegamestore.online";

export interface DraftSession {
  id: string;
  name: string;
  createdAt: string;
  gameId?: string;
}

interface ServerSession {
  id: string;
  name: string;
  gameId?: string;
  deployed: boolean;
  createdAt: string;
}

export function useDraftSessions() {
  const { user } = useAuth();
  const [drafts, setDrafts] = useState<DraftSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!user) {
      setDrafts([]);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    fetch(`${AGENT_URL}/sessions`, { credentials: "include", signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { sessions: ServerSession[] }) => {
        // Only undeployed sessions are "drafts" — deployed ones already appear as
        // Live games in the registry-backed "Your Games" list.
        setDrafts(
          (data.sessions || [])
            .filter((s) => !s.deployed)
            .map((s) => ({ id: s.id, name: s.name || "Untitled", createdAt: s.createdAt, gameId: s.gameId })),
        );
      })
      .catch(() => {
        // Non-fatal: drafts are a convenience surface, never block the dashboard.
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [user?.sub, nonce]);

  const discard = useCallback(async (id: string) => {
    setDrafts((prev) => prev.filter((d) => d.id !== id)); // optimistic
    await fetch(`${AGENT_URL}/sessions/${id}`, { method: "DELETE", credentials: "include" }).catch(() => {});
  }, []);

  return { drafts, loading, refresh, discard };
}
