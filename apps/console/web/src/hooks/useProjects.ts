import { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import { AGENT_URL, useSharedSessions, invalidateSharedSessions } from '../lib/agentClient';
import {
  clearLegacyCurrentProjectId,
  readCurrentProjectId,
  readLegacyCurrentProjectId,
  writeCurrentProjectId,
} from '../lib/currentProjectStorage';
import { reportError } from '../lib/errorReporter';
import { mapServerSession, type Project } from '../lib/sessions';
import { useAuth } from './useAuth';

// Thrown when an in-flight openGame / startFreshChat is superseded by a newer
// user intent (picker switch or direct navigation). Callers that catch ALL
// errors (like useAgent.openGame) should check for this name and silently
// discard rather than surfacing it to the user.
export class OpenSupersededError extends Error {
  override readonly name = 'OpenSupersededError';
}

export type { Project };

function placeholderProject(id: string, name = 'Current game'): Project {
  return {
    id,
    name,
    createdAt: new Date().toISOString(),
    updatedAt: Date.now(),
    deployed: false,
  };
}

async function putSession(project: Project, attempt = 0): Promise<void> {
  // Session content (messages/files) is persisted by the DO during chat; this
  // only upserts the lightweight index row (title + deployed game). Retry a
  // couple times: for markDeployed this row is what flips a live game out of the
  // dashboard inventory, so a dropped PUT would otherwise leave a shipped
  // game looking like an unfinished draft until the next manual index write.
  try {
    const res = await fetch(`${AGENT_URL}/sessions/${project.id}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: project.name,
        gameId: project.appId,
        gameUrl: project.appUrl,
        deployed: project.deployed,
      }),
    });
    if (!res.ok) throw new Error(`putSession ${res.status}`);
  } catch {
    if (attempt < 2) {
      setTimeout(() => void putSession(project, attempt + 1), 500 * (attempt + 1));
      return;
    }
    // Gave up — the DO also marks `deployed` server-side on a live deploy, and
    // the next reload reconciles the rest from the server index.
  }
}

export function useProjects() {
  const { user, loading: authLoading } = useAuth();
  const cacheData = useSharedSessions([user?.sub]);
  const [projects, setProjects] = useState<Project[]>([]);
  // Projects are updated ONLY through commitProjects: the transition runs once,
  // synchronously, against the latest list, and callers do their side effects
  // (putSession, setCurrentId) AFTER it returns. Side effects inside a React
  // updater run twice under StrictMode (and can in concurrent rendering), which
  // double-sent every PUT (#80).
  const projectsRef = useRef<Project[]>([]);
  const commitProjects = useCallback(
    (update: Project[] | ((prev: Project[]) => Project[])): Project[] => {
      const next = typeof update === 'function' ? update(projectsRef.current) : update;
      projectsRef.current = next;
      setProjects(next);
      return next;
    },
    [],
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [currentId, setCurrentIdState] = useState<string | null>(null);
  // Monotonic counter — incremented on every explicit user intent (switchTo,
  // openGame, startFreshChat, setCurrentId). An in-flight openGame / startFreshChat
  // captures this value at call time and compares after each await; if the value has
  // advanced, the user has since switched to something else and we discard the stale
  // setCurrentId call (same pattern as loadHistory / sendMessage in useAgent).
  const openTokenRef = useRef(0);

  const setCurrentId = useCallback(
    (id: string | null) => {
      openTokenRef.current += 1;
      setCurrentIdState(id);
      writeCurrentProjectId(user?.sub, id);
    },
    [user?.sub],
  );

  useEffect(() => {
    try {
      localStorage.removeItem('fgs_projects');
    } catch {
      // harmless
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on user.sub, not the user object — a new object for the same account must not refetch.
  useEffect(() => {
    if (authLoading) {
      setLoading(true);
      return;
    }

    if (!user) {
      commitProjects([]);
      setCurrentId(null);
      setLoading(false);
      return;
    }

    if (cacheData.error && cacheData.loaded) {
      setLoadError(true);
      setLoading(false);
      reportError({
        message: cacheData.error.message,
        context: JSON.stringify({ op: 'loadProjects' }),
      });
      return;
    }

    setLoadError(false);

    // Transform shared sessions into projects using mapServerSession
    const now = Date.now();
    const server = cacheData.sessions.map((session) => mapServerSession(session, now));

    // No phantom auto-create: an empty list stays empty (the studio shows a
    // "start or open a game" state) instead of spawning a blank "New Game"
    // session on every visit — those unbound shells piled up and made it
    // look like chat had vanished when switching between them.
    const scopedStored = readCurrentProjectId(user.sub);
    const legacyStored = readLegacyCurrentProjectId();
    const legacyInList = !!legacyStored && server.some((project) => project.id === legacyStored);
    if (legacyStored && !legacyInList) clearLegacyCurrentProjectId();
    const stored = scopedStored || (legacyInList ? legacyStored : null);
    const storedInList = !!stored && server.some((project) => project.id === stored);

    // Never abandon the open session on reload. The transcript lives in the
    // Durable Object keyed by `stored`; the D1 list is only a convenience
    // index. If that index is missing this row (a create/import whose
    // upsert failed or raced the reload), switching to server[0] threw the
    // user onto a DIFFERENT session — which read as "all my messages
    // vanished." Keep `stored` and add a lightweight placeholder so the
    // picker/toolbar have an entry; loadHistory() fills in the real
    // transcript + name from the DO.
    if (stored && !storedInList) {
      commitProjects([placeholderProject(stored), ...server]);
      setCurrentId(stored);
      setLoading(!cacheData.loaded);
      return;
    }

    commitProjects(server);
    // Only auto-open the session the user actually left open (stored). With no
    // valid stored id — first visit, cleared storage, or a deleted session —
    // land on the empty "start or open a game" state instead of silently
    // dropping into the most-recent game (server[0]). That silent default let
    // a user think they were in a fresh chat while actually sitting in a live
    // game's session, so their next prompt edited that game (slicing-game
    // overwritten as Beat Star, 2026-07-18). Make opening a game an explicit act.
    setCurrentId(storedInList ? stored : null);
    setLoading(!cacheData.loaded);
  }, [authLoading, user?.sub, cacheData.sessions, cacheData.loaded, cacheData.error, setCurrentId]);

  const create = useCallback(
    (name: string, appId?: string) => {
      const id = crypto.randomUUID();
      const project: Project = {
        id,
        name,
        createdAt: new Date().toISOString(),
        updatedAt: Date.now(),
        deployed: !!appId,
        appId,
        appUrl: appId ? `https://${appId}.freegamestore.online` : undefined,
      };
      commitProjects((prev) => [project, ...prev]);
      setCurrentId(id);
      putSession(project);
      return id;
    },
    [setCurrentId, commitProjects],
  );

  const switchTo = useCallback(
    (id: string) => {
      commitProjects((prev) =>
        prev.some((project) => project.id === id) ? prev : [placeholderProject(id), ...prev],
      );
      setCurrentId(id);
    },
    [setCurrentId, commitProjects],
  );

  // Open an EXISTING game in the studio. If a local session is already bound to
  // it, switch to that. Otherwise create a fresh session and IMPORT the game's
  // real repo files into it (so a later edit + push_update updates the game
  // rather than overwriting it with a blank scaffold — the bug the old picker's
  // "create empty session linked to repo" path caused). Returns the session id.
  const openGame = useCallback(
    async (gameId: string): Promise<string> => {
      // Capture the token BEFORE the first await so we can detect a user switching
      // away mid-flight. If the token advances after any await it means switchTo /
      // setCurrentId was called with a DIFFERENT intent and we must not clobber it.
      // (Same guard pattern as loadHistory / sendMessage in useAgent.)
      const token = openTokenRef.current;

      // Resolve the session that already owns this game so we reuse it (and its
      // chat transcript) instead of minting a duplicate. Check the local list
      // first (fast path), then fall back to the AUTHORITATIVE server index: the
      // local list can be stale, empty (another browser / a cache clear), or miss
      // a session that a deploy — not a prior open — bound to this game. Deduping
      // against the server here is what enforces one game ↔ one session; without
      // it, every open of an already-built game spawned a second session and a
      // duplicate picker row.
      let existing = projects.find((p) => p.appId === gameId);
      // If not in local projects, the shared cache should have the latest version
      // since useSharedSessions is continuously synced from the server
      // If the user switched away while we were fetching sessions, discard.
      if (openTokenRef.current !== token)
        throw new OpenSupersededError(`openGame("${gameId}") superseded by a newer selection`);

      // Always re-import: the endpoint re-syncs the session's files from the repo
      // HEAD, so changes made directly (update_files / git / another session)
      // since you last opened it are picked up. Import is cheap when the repo
      // hasn't moved (it short-circuits server-side).
      const id = existing?.id ?? crypto.randomUUID();
      const res = await fetch(`${AGENT_URL}/session/${id}/import`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: gameId }),
      });
      if (!res.ok) {
        const msg = ((await res.json().catch(() => ({}))) as { error?: string }).error;
        throw new Error(msg || `Couldn't open "${gameId}" (${res.status}).`);
      }
      const data = (await res.json()) as { name?: string; appUrl?: string };
      const project: Project = {
        id,
        name: data.name || gameId,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        updatedAt: Date.now(),
        deployed: true,
        appId: gameId,
        appUrl: data.appUrl || `https://${gameId}.freegamestore.online`,
      };
      // Always update the project row (keeps the local list in sync with the import
      // result), but only switch the active session if the user hasn't already moved
      // on to a different game in the time the async import was in flight.
      commitProjects((prev) => [project, ...prev.filter((p) => p.id !== id)]);
      if (openTokenRef.current === token) {
        setCurrentId(id);
      }
      putSession(project);
      return id;
    },
    [projects, setCurrentId, commitProjects],
  );

  // Start a FRESH chat for an already-built game: mint a brand-new session id
  // (a new Durable Object = a clean, empty transcript) and IMPORT the game's real
  // repo files into it, then remove the game's OLD session(s) from the list. This
  // is the escape hatch for a session whose conversation has gone bad — you keep
  // the deployed game and its code, and just start the chat over. `openGame`
  // deliberately REUSES an existing session (to preserve history), so it can't
  // escape a poisoned one; this is the deliberate opposite. Returns the new id.
  const startFreshChat = useCallback(
    async (gameId: string): Promise<string> => {
      // Capture token before first await (same race-guard as openGame).
      const token = openTokenRef.current;

      // Every session currently bound to this game — use the current project list
      // which is synced from the server via useSharedSessions, so we can drop them
      // all (a game may have accreted more than one session across browsers/deploys).
      const stale = new Set(projects.filter((p) => p.appId === gameId).map((p) => p.id));
      if (openTokenRef.current !== token)
        throw new OpenSupersededError(
          `startFreshChat("${gameId}") superseded by a newer selection`,
        );

      const id = crypto.randomUUID();
      const res = await fetch(`${AGENT_URL}/session/${id}/import`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: gameId }),
      });
      if (!res.ok) {
        const msg = ((await res.json().catch(() => ({}))) as { error?: string }).error;
        throw new Error(msg || `Couldn't start a fresh chat for "${gameId}" (${res.status}).`);
      }
      const data = (await res.json()) as { name?: string; appUrl?: string };
      const project: Project = {
        id,
        name: data.name || gameId,
        createdAt: new Date().toISOString(),
        updatedAt: Date.now(),
        deployed: true,
        appId: gameId,
        appUrl: data.appUrl || `https://${gameId}.freegamestore.online`,
      };
      // Swap in the fresh session and drop every stale one for this game.
      commitProjects((prev) => [project, ...prev.filter((p) => !stale.has(p.id))]);
      if (openTokenRef.current === token) {
        setCurrentId(id);
      }
      putSession(project);
      // Best-effort: remove the stale index rows server-side (their DO transcripts
      // become orphaned + unreachable, which is fine — nothing references them).
      for (const oldId of stale) {
        fetch(`${AGENT_URL}/sessions/${oldId}`, { method: 'DELETE', credentials: 'include' }).catch(
          () => {},
        );
      }
      return id;
    },
    [projects, setCurrentId, commitProjects],
  );

  const rename = useCallback(
    (id: string, name: string) => {
      const prev = projectsRef.current;
      const existing = prev.find((project) => project.id === id);
      if (!existing) {
        commitProjects([placeholderProject(id, name), ...prev]);
        return;
      }
      if (existing.name === name) return;
      const project = { ...existing, name, updatedAt: Date.now() };
      commitProjects(prev.map((candidate) => (candidate.id === id ? project : candidate)));
      putSession(project);
    },
    [commitProjects],
  );

  // Remove a session (a draft, or any session you no longer want in the studio).
  // Deletes the D1 index row; the DO transcript is left orphaned but unreachable.
  // Moves you to the next session (or the empty state) so the studio never sits
  // pointed at a session that no longer exists.
  const deleteProject = useCallback(
    (id: string) => {
      const remaining = commitProjects((prev) => prev.filter((p) => p.id !== id));
      if (currentId === id) setCurrentId(remaining[0]?.id ?? null);
      fetch(`${AGENT_URL}/sessions/${id}`, { method: 'DELETE', credentials: 'include' }).catch(
        () => {
          // Best-effort; the next reload reconciles from the server.
        },
      );
    },
    [currentId, setCurrentId, commitProjects],
  );

  const markDeployed = useCallback(
    (sessionId: string, appId: string, appUrl: string) => {
      const prev = projectsRef.current;
      const existing = prev.find((project) => project.id === sessionId);
      if (existing?.deployed && existing.appId === appId && existing.appUrl === appUrl) return;
      if (!existing) {
        const project: Project = {
          ...placeholderProject(sessionId, appId),
          appId,
          appUrl,
          deployed: true,
        };
        commitProjects([project, ...prev]);
        putSession(project);
        return;
      }
      // Keep the user's chosen project name — don't overwrite it with the repo id.
      const project = { ...existing, appId, appUrl, deployed: true, updatedAt: Date.now() };
      commitProjects(prev.map((candidate) => (candidate.id === sessionId ? project : candidate)));
      putSession(project);
    },
    [commitProjects],
  );

  // Return memoized object to prevent unnecessary re-renders in downstream hooks
  return useMemo(
    () => ({
      projects,
      currentId,
      loading,
      loadError,
      reload: () => {
        // Invalidate the shared sessions cache to force a refetch
        invalidateSharedSessions();
        setLoading(true);
      },
      create,
      switchTo,
      openGame,
      startFreshChat,
      rename,
      markDeployed,
      deleteProject,
    }),
    [
      projects,
      currentId,
      loading,
      loadError,
      create,
      switchTo,
      openGame,
      startFreshChat,
      rename,
      markDeployed,
      deleteProject,
    ],
  );
}
