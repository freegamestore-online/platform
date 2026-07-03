import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./useAuth";

export interface Project {
  id: string;          // agent session UUID — this is the Durable Object key
  name: string;
  createdAt: string;
  updatedAt: number;
  appId?: string;      // set after deploy — the GitHub repo / game name
  appUrl?: string;     // preview URL (pages.dev)
  deployed: boolean;
}

// The agent worker owns BOTH the session index (its D1) and the transcripts
// (its Durable Objects). The console reads/writes that single source of truth —
// the same origin it already uses for chat + /history — rather than a separate
// publisher store, which forks the project list away from where the real
// sessions live (and leaves the picker empty while transcripts sit orphaned).
const AGENT_URL = "https://agent.freegamestore.online";

interface ServerSession {
  id: string;
  name: string;
  gameId?: string;
  gameUrl?: string;
  deployed: boolean;
  createdAt: string; // D1 datetime text, e.g. "2026-06-29 21:26:52"
}

const CURRENT_KEY = "fgs_current_project";

async function fetchSessions(signal: AbortSignal): Promise<Project[]> {
  const res = await fetch(`${AGENT_URL}/sessions`, { signal, credentials: "include" });
  if (!res.ok) throw new Error(`fetch sessions failed: ${res.status}`);
  const data = (await res.json()) as { sessions: ServerSession[] };
  return data.sessions.map((session) => {
    const ms = Date.parse(session.createdAt);
    return {
      id: session.id,
      name: session.name,
      appId: session.gameId,
      appUrl: session.gameUrl,
      deployed: session.deployed,
      createdAt: Number.isNaN(ms) ? new Date().toISOString() : new Date(ms).toISOString(),
      updatedAt: Number.isNaN(ms) ? Date.now() : ms,
    };
  });
}

function putSession(project: Project): void {
  // Session content (messages/files) is persisted by the DO during chat; this
  // only upserts the lightweight index row (title + deployed game).
  fetch(`${AGENT_URL}/sessions/${project.id}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: project.name,
      gameId: project.appId,
      gameUrl: project.appUrl,
      deployed: project.deployed,
    }),
  }).catch(() => {
    // The next reload will reconcile from the server.
  });
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
        setProjects(server);
        if (server.length === 0) {
          setCurrentId(null);
          return;
        }
        const stored = localStorage.getItem(CURRENT_KEY);
        const validStored = stored && server.some((project) => project.id === stored);
        setCurrentId(validStored ? stored : server[0]!.id);
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
    const existing = projects.find((p) => p.appId === gameId);
    if (existing) {
      setCurrentId(existing.id);
      return existing.id;
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
      throw new Error(msg || `Couldn't open "${gameId}" (${res.status}).`);
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
    setProjects((prev) => [project, ...prev.filter((p) => p.id !== id)]);
    setCurrentId(id);
    putSession(project);
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

  return { projects, currentId, loading, loadError, reload, create, switchTo, openGame, rename, markDeployed };
}
