import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { clearLegacyLocalKeys } from '../lib/ai-keys';
import { reportError } from '../lib/errorReporter';

/** freegamestore-auth worker — the store-wide identity provider. */
const AUTH_BASE = 'https://auth.freegamestore.online';
const AGENT_BASE = 'https://agent.freegamestore.online';

async function establishAgentSession(): Promise<void> {
  const issued = await fetch('/auth/agent-handoff', { method: 'POST', credentials: 'include' });
  if (!issued.ok) throw new Error('agent session handoff failed');
  const { token } = (await issued.json()) as { token?: string };
  if (!token) throw new Error('agent session handoff was empty');
  const established = await fetch(`${AGENT_BASE}/auth/handoff?token=${encodeURIComponent(token)}`, {
    credentials: 'include',
  });
  if (!established.ok) throw new Error('agent rejected session handoff');
}

/** A game published to FreeGameStore by this creator. */
export interface GameRepo {
  id: string;
  name: string;
  previewUrl: string;
  liveUrl: string;
  repoUrl: string;
  /** First published (created). */
  createdAt: string;
  /** Registry metadata edit time (name/description/icon/…). */
  updatedAt: string;
  /** Last code change — the repo's GitHub pushed_at. */
  lastEditedAt: string;
  published: boolean;
  category: string;
  icon: string;
  iconBg: string;
  description: string;
  /** Immutable remix lineage supplied by the registry API. Older entries may
   * only have the source id; the UI deliberately renders that without guessing. */
  forkedFrom?:
    | {
        id: string;
        name: string;
        creatorGithub: string;
        forkedAt: string;
      }
    | string;
  /** Whether the source still exists in the live registry (safe-link signal). */
  forkedFromSourceAvailable?: boolean;
}

interface CreatorRecord {
  github: string;
  games: GameRepo[];
  banned: boolean;
  maxGames: number;
  remaining: number;
}

interface AuthUser {
  github: string;
  avatarUrl: string;
  /** Numeric GitHub user id — the canonical UID. */
  githubId: number | null;
  /** Stable subject identifier, e.g. "github:2824906". */
  sub: string | null;
  name: string | null;
  email: string | null;
  createdAt: string | null;
}

/** GitHub avatar URLs embed the numeric user id: .../u/<id>?v=4 */
function uidFromAvatar(avatarUrl: string): number | null {
  const m = avatarUrl.match(/\/u\/(\d+)/);
  return m ? Number(m[1]) : null;
}

interface AuthContextValue {
  user: AuthUser | null;
  creator: CreatorRecord | null;
  creatorError: string | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  fetchCreator: () => Promise<void>;
  reloadCreator: () => Promise<void>;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  creator: null,
  creatorError: null,
  loading: true,
  error: null,
  refetch: async () => {},
  fetchCreator: async () => {},
  reloadCreator: async () => {},
  signIn: async () => {},
  signOut: async () => {},
});

/** Access the current auth state (user, creator, loading, signIn/signOut). */
export function useAuth() {
  return useContext(AuthContext);
}

/** Auth provider hook — manages session state, GitHub OAuth, and creator data. */
export function useAuthProvider(): AuthContextValue {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [creator, setCreator] = useState<CreatorRecord | null>(null);
  const [creatorError, setCreatorError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      const meRes = await fetch('/auth/me');
      const meData = (await meRes.json()) as {
        user: {
          github: string;
          avatarUrl: string;
          githubId?: number;
          sub?: string;
          name?: string | null;
          email?: string | null;
          createdAt?: string | null;
        } | null;
      };

      if (!meData.user) {
        setUser(null);
        setCreator(null);
        return;
      }

      // Older sessions predate id capture — derive the UID from the avatar URL.
      const githubId = meData.user.githubId ?? uidFromAvatar(meData.user.avatarUrl);

      setUser({
        github: meData.user.github,
        avatarUrl: meData.user.avatarUrl,
        githubId,
        sub: meData.user.sub ?? (githubId != null ? `github:${githubId}` : null),
        name: meData.user.name ?? null,
        email: meData.user.email ?? null,
        createdAt: meData.user.createdAt ?? null,
      });
      // Agent is a separate origin. Establish its own HttpOnly host cookie
      // before Studio mounts any credentialed agent requests.
      await establishAgentSession();
    } catch (e) {
      console.error('[auth] error:', e);
      reportError({
        message: (e as Error).message || 'Auth fetch failed',
        context: JSON.stringify({ op: 'auth' }),
      });
      setError('Failed to connect to server');
    } finally {
      setLoading(false);
    }
  }, []);

  // Lazy fetch creator/game list — only called by pages that need it (Dashboard).
  // A failure here must NOT be silently swallowed: the dashboard used to gate its
  // sign-in prompt on `!creator`, so a failed /api/me made a signed-in user see
  // "Sign in to publish." Surface the error so the UI can show a retry instead.
  // The actual /api/me load — stable (no `creator` dep), so it can be used to
  // force a refresh. `fetchCreator` wraps it with the lazy first-load guard;
  // `reloadCreator` calls it unguarded so a create/publish can refresh the list
  // in-session (the guard otherwise froze the game list until a full reload).
  const loadCreator = useCallback(async () => {
    try {
      const creatorRes = await fetch('/api/me');
      if (creatorRes.ok) {
        const creatorData = (await creatorRes.json()) as { creator: CreatorRecord };
        setCreator(creatorData.creator);
        setCreatorError(null);
      } else {
        setCreatorError(`Couldn't load your games (${creatorRes.status}). Please retry.`);
      }
    } catch {
      setCreatorError("Couldn't load your games. Check your connection and retry.");
    }
  }, []);

  const fetchCreator = useCallback(async () => {
    if (creator) return;
    await loadCreator();
  }, [creator, loadCreator]);

  const reloadCreator = loadCreator;

  useEffect(() => {
    refetch();
  }, [refetch]);

  // Sign-in is delegated to the freegamestore-auth worker (single identity
  // provider). The callback hands a signed, five-minute code to this origin,
  // which writes its own host-only session cookie before redirecting back.
  const signIn = useCallback(async () => {
    const returnTo = window.location.href;
    window.location.href = `${AUTH_BASE}/login?redirect=${encodeURIComponent(returnTo)}`;
  }, []);

  const signOut = useCallback(async () => {
    clearLegacyLocalKeys(user?.sub);
    // The console session is a host-only cookie on this origin, so it has to be
    // cleared here; the auth worker's /logout only ends the auth-origin session.
    await Promise.all([
      fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {}),
      fetch(`${AUTH_BASE}/logout`, { method: 'POST', credentials: 'include' }).catch(() => {}),
    ]);
    setUser(null);
    setCreator(null);
    window.location.href = '/';
  }, [user?.sub]);

  return {
    user,
    creator,
    creatorError,
    loading,
    error,
    refetch,
    fetchCreator,
    reloadCreator,
    signIn,
    signOut,
  };
}
