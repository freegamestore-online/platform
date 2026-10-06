import { useCallback, useEffect, useState } from 'react';
import { AGENT_URL, useSharedSessions } from '../lib/agentClient';
import {
  activityByGameId,
  type DraftSession,
  type SessionActivity,
  toDrafts,
} from '../lib/sessions';
import { useAuth } from './useAuth';

// Drafts (in-progress Studio sessions that haven't deployed to a live game)
// live in the agent's D1 session index, keyed by the signed-in user — the SAME
// source the studio's session picker reads. The dashboard reads it too so a game
// you're still building doesn't look lost: My Games shows registry (Live) games
// and undeployed sessions together. A session becomes a Live game once it deploys.

export type { DraftSession };

export function useDraftSessions() {
  const { user } = useAuth();
  const cacheData = useSharedSessions([user?.sub]);
  const [drafts, setDrafts] = useState<DraftSession[]>([]);
  const [activity, setActivity] = useState<Map<string, SessionActivity>>(new Map());
  const [loading, setLoading] = useState(!user);

  const refresh = useCallback(() => {
    // The shared sessions cache handles invalidation internally.
    // For now, just trigger a re-render by touching loading.
    setLoading(true);
    setLoading(false);
  }, []);

  // Update drafts whenever sessions change
  useEffect(() => {
    if (!user) {
      setDrafts([]);
      setActivity(new Map());
      return;
    }
    setDrafts(toDrafts(cacheData.sessions));
    setActivity(activityByGameId(cacheData.sessions));
  }, [cacheData.sessions, user]);

  const discard = useCallback(async (id: string) => {
    setDrafts((prev) => prev.filter((d) => d.id !== id)); // optimistic
    await fetch(`${AGENT_URL}/sessions/${id}`, { method: 'DELETE', credentials: 'include' }).catch(
      () => {},
    );
  }, []);

  // Rename a draft session. `deployed:false` is sent explicitly: the agent's PUT
  // overwrites the deployed flag (not COALESCE'd), and a draft is by definition
  // not deployed — so this can't accidentally flip a live game's state.
  const rename = useCallback(async (id: string, title: string): Promise<boolean> => {
    const res = await fetch(`${AGENT_URL}/sessions/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ title, deployed: false }),
    }).catch(() => null);
    if (res?.ok) {
      setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, name: title } : d)));
      return true;
    }
    return false;
  }, []);

  return { drafts, activity, loading, refresh, discard, rename };
}
