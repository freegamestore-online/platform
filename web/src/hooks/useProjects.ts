import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./useAuth";
import { mapServerSession, type Project, type ServerSession } from "../lib/sessions";

export type { Project };

// The agent worker owns BOTH the session index (its D1) and the transcripts
// (its Durable Objects). The console reads/writes that single source of truth —
// the same origin it already uses for chat + /history — rather than a separate
// publisher store, which forks the project list away from where the real
// sessions live (and leaves the picker empty while transcripts sit orphaned).
const AGENT_URL = "https://agent.freegamestore.online";

const CURRENT_KEY = "fgs_current_project";

async function fetchSessions(signal: AbortSignal): Promise<Project[]> {
  const res = await fetch(`${AGENT_URL}/sessions`, { signal, credentials: "include" });
  if (!res.ok) throw new Error(`fetch sessions failed: ${res.status}`);
  const data = (await res.json()) as { sessions: ServerSession[] };
  const now = Date.now();
  return data.sessions.map((session) => mapServerSession(session, now));
}

async function putSession(project: Project, attempt = 0): Promise<void> {
  // Session content (messages/files) is persisted by the DO during chat; this
  // only upserts the lightweight index row (title + deployed game). Retry a
  // couple times: for markDeployed this row is what flips a live game out of the
  // Dashboard "Drafts" list, so a dropped PUT would otherwise leave a shipped
  // game looking like an unfinished draft until the next manual index write.
  try {
    const res = await fetch(`${AGENT_URL}/sessions/${project.id}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
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
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [currentId, setCurrentIdState] = useState<string | null>(() => localStorage.getItem(CURRENT_KEY));

  const reload = useCallback(() => setReloadNonce((n) => n + 1), []);

  const setCurrentId = useCallback((id: string | null) => {
    setCurrentIdState(id);
    if (id) localStorage.setItem(CURRENT_KEY, id);
    else localStorage.removeItem(CURRENT_KEY);
  }, []);

  useEffect(() => {
    try {
      localStorage.removeItem("fgs_projects");
    } catch {
      // harmless
    }
  }, []);

  useEffect(() => {
    if (!user) {
      setProjects([]);
      setCurrentId(null);
      setLoading(false);
      return;
    }

    const ctrl = new AbortController();
    setLoading(true);
    setLoadError(false);

    fetchSessions(ctrl.signal)
      .then((server) => {
        // No phantom auto-create: an empty list stays empty (the studio shows a
        // "start or open a game" state) instead of spawning a blank "New Game"
        // session on every visit — those unbound shells piled up and made it
        // look like chat had vanished when switching between them.
        const stored = localStorage.getItem(CURRENT_KEY);
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
          const placeholder: Project = {
            id: stored,
            name: "Current game",
            createdAt: new Date().toISOString(),
            updatedAt: Date.now(),
            deployed: false,
          };
          setProjects([placeholder, ...server]);
          setCurrentId(stored);
          return;
        }

        setProjects(server);
        setCurrentId(server.length === 0 ? null : storedInList ? stored : server[0]!.id);
      })
      .catch((err) => {
        if ((err as Error).name !== "AbortError") {
          console.error("Failed to load projects:", err);
          setLoadError(true);
        }
      })
      .finally(() => setLoading(false));

    return () => ctrl.abort();
  }, [user?.sub, reloadNonce, setCurrentId]);

  const create = useCallback((name: string, appId?: string) => {
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
    setProjects((prev) => [project, ...prev]);
    setCurrentId(id);
    putSession(project);
    return id;
  }, [setCurrentId]);

  const switchTo = useCallback((id: string) => {
    setCurrentId(id);
  }, [setCurrentId]);

  // Open an EXISTING game in the studio. If a local session is already bound to
  // it, switch to that. Otherwise create a fresh session and IMPORT the game's
  // real repo files into it (so a later edit + push_update updates the game
  // rather than overwriting it with a blank scaffold — the bug the old picker's
  // "create empty session linked to repo" path caused). Returns the session id.
  const openGame = useCallback(async (gameId: string): Promise<string> => {
    // Resolve the session that already owns this game so we reuse it (and its
    // chat transcript) instead of minting a duplicate. Check the local list
    // first (fast path), then fall back to the AUTHORITATIVE server index: the
    // local list can be stale, empty (another browser / a cache clear), or miss
    // a session that a deploy — not a prior open — bound to this game. Deduping
    // against the server here is what enforces one game ↔ one session; without
    // it, every open of an already-built game spawned a second session and a
    // duplicate picker row.
    let existing = projects.find((p) => p.appId === gameId);
    if (!existing) {
      try {
        const server = await fetchSessions(new AbortController().signal);
        existing = server.find((p) => p.appId === gameId);
      } catch {
        // Server unreachable — fall through and mint a fresh session; the next
        // reload/open reconciles against the server index.
      }
    }
    // Always re-import: the endpoint re-syncs the session's files from the repo
    // HEAD, so changes made directly (update_files / git / another session)
    // since you last opened it are picked up. Import is cheap when the repo
    // hasn't moved (it short-circuits server-side).
    const id = existing?.id ?? crypto.randomUUID();
    const res = await fetch(`${AGENT_URL}/session/${id}/import`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
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
    setProjects((prev) => [project, ...prev.filter((p) => p.id !== id)]);
    setCurrentId(id);
    putSession(project);
    return id;
  }, [projects, setCurrentId]);

  // Start a FRESH chat for an already-built game: mint a brand-new session id
  // (a new Durable Object = a clean, empty transcript) and IMPORT the game's real
  // repo files into it, then remove the game's OLD session(s) from the list. This
  // is the escape hatch for a session whose conversation has gone bad — you keep
  // the deployed game and its code, and just start the chat over. `openGame`
  // deliberately REUSES an existing session (to preserve history), so it can't
  // escape a poisoned one; this is the deliberate opposite. Returns the new id.
  const startFreshChat = useCallback(async (gameId: string): Promise<string> => {
    // Every session currently bound to this game — local list + authoritative
    // server index — so we can drop them all (a game may have accreted more than
    // one session across browsers/deploys).
    const stale = new Set(projects.filter((p) => p.appId === gameId).map((p) => p.id));
    try {
      const server = await fetchSessions(new AbortController().signal);
      server.filter((p) => p.appId === gameId).forEach((p) => stale.add(p.id));
    } catch {
      // Offline — drop just the local ones; the next reload reconciles.
    }

    const id = crypto.randomUUID();
    const res = await fetch(`${AGENT_URL}/session/${id}/import`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
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
    setProjects((prev) => [project, ...prev.filter((p) => !stale.has(p.id))]);
    setCurrentId(id);
    putSession(project);
    // Best-effort: remove the stale index rows server-side (their DO transcripts
    // become orphaned + unreachable, which is fine — nothing references them).
    for (const oldId of stale) {
      fetch(`${AGENT_URL}/sessions/${oldId}`, { method: "DELETE", credentials: "include" }).catch(() => {});
    }
    return id;
  }, [projects, setCurrentId]);

  const rename = useCallback((id: string, name: string) => {
    setProjects((prev) => {
      const existing = prev.find((project) => project.id === id);
      if (!existing || existing.name === name) return prev;
      const updated = prev.map((project) => (project.id === id ? { ...project, name, updatedAt: Date.now() } : project));
      const project = updated.find((candidate) => candidate.id === id);
      if (project) putSession(project);
      return updated;
    });
  }, []);

  // Remove a session (a draft, or any session you no longer want in the studio).
  // Deletes the D1 index row; the DO transcript is left orphaned but unreachable.
  // Moves you to the next session (or the empty state) so the studio never sits
  // pointed at a session that no longer exists.
  const deleteProject = useCallback((id: string) => {
    setProjects((prev) => {
      const remaining = prev.filter((p) => p.id !== id);
      if (currentId === id) setCurrentId(remaining[0]?.id ?? null);
      return remaining;
    });
    fetch(`${AGENT_URL}/sessions/${id}`, { method: "DELETE", credentials: "include" }).catch(() => {
      // Best-effort; the next reload reconciles from the server.
    });
  }, [currentId, setCurrentId]);

  const markDeployed = useCallback((sessionId: string, appId: string, appUrl: string) => {
    setProjects((prev) => {
      const existing = prev.find((project) => project.id === sessionId);
      if (existing?.deployed && existing.appId === appId && existing.appUrl === appUrl) {
        return prev;
      }
      // Keep the user's chosen project name — don't overwrite it with the repo id.
      const updated = prev.map((project) =>
        project.id === sessionId ? { ...project, appId, appUrl, deployed: true, updatedAt: Date.now() } : project,
      );
      const project = updated.find((candidate) => candidate.id === sessionId);
      if (project) putSession(project);
      return updated;
    });
  }, []);

  return { projects, currentId, loading, loadError, reload, create, switchTo, openGame, startFreshChat, rename, markDeployed, deleteProject };
}
