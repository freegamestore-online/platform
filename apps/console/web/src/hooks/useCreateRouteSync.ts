import { useCallback, useEffect, useRef, useState } from 'react';

export interface RouteProject {
  id: string;
  appId?: string;
}

interface RouteSyncOptions<T extends RouteProject> {
  urlKey?: string;
  ready: boolean;
  isStreaming: boolean;
  projectsLoading: boolean;
  projects: T[];
  currentProjectId: string | null;
  hasLegacyDeepLink: boolean;
  openGame(gameId: string): Promise<string | null>;
  switchProject(id: string): void;
  navigate(path: string, options?: { replace?: boolean }): void;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function routeKey(project: RouteProject | null | undefined): string | null {
  return project?.appId || project?.id || null;
}

/** The one authority for translating the create route to and from the open session. */
export function useCreateRouteSync<T extends RouteProject>({
  urlKey,
  ready,
  isStreaming,
  projectsLoading,
  projects,
  currentProjectId,
  hasLegacyDeepLink,
  openGame,
  switchProject,
  navigate,
}: RouteSyncOptions<T>) {
  const resolvedKeyRef = useRef<string | null>(null);
  const pendingSelfNavRef = useRef<string | null | undefined>(undefined);
  const [resolvingUrl, setResolvingUrl] = useState(false);
  const currentProject = projects.find((project) => project.id === currentProjectId);

  const navigateToProject = useCallback(
    (
      project: RouteProject | null | undefined,
      options: { replace?: boolean; alreadyOpen?: boolean } = {},
    ) => {
      const { replace = false, alreadyOpen = false } = options;
      const key = routeKey(project);
      if (!key) {
        if (alreadyOpen) {
          resolvedKeyRef.current = null;
          pendingSelfNavRef.current = null;
        }
        navigate('/create', { replace });
        return;
      }
      if (alreadyOpen) {
        resolvedKeyRef.current = key;
        pendingSelfNavRef.current = key;
      }
      navigate(`/create/${key}`, { replace });
    },
    [navigate],
  );

  // The URL is the sole opener. The resolution latch prevents unrelated renders
  // from opening a game twice; self-write tracking prevents a stale URL from
  // reopening a game after delete/fresh-chat changed the current session.
  useEffect(() => {
    if (!ready || projectsLoading || isStreaming) return;
    if (pendingSelfNavRef.current !== undefined) {
      if (pendingSelfNavRef.current !== (urlKey ?? null)) return;
      pendingSelfNavRef.current = undefined;
    }
    if (!urlKey || resolvedKeyRef.current === urlKey) return;
    resolvedKeyRef.current = urlKey;
    const project = projects.find(
      (candidate) => candidate.appId === urlKey || candidate.id === urlKey,
    );
    if (project?.id === currentProjectId) return;
    if (project && !project.appId) {
      switchProject(project.id);
      return;
    }
    const gameId = project?.appId ?? (UUID_RE.test(urlKey) ? null : urlKey);
    if (!gameId) {
      switchProject(urlKey);
      return;
    }
    setResolvingUrl(true);
    const revertKey = routeKey(currentProject);
    void openGame(gameId)
      .then((openedId) => {
        if (openedId || resolvedKeyRef.current !== urlKey) return;
        navigate(revertKey ? `/create/${revertKey}` : '/create', { replace: true });
      })
      .finally(() => setResolvingUrl(false));
  }, [
    urlKey,
    ready,
    projectsLoading,
    isStreaming,
    projects,
    currentProjectId,
    openGame,
    switchProject,
    currentProject,
    navigate,
  ]);

  // This is feedback only: a draft promoted to a deployed game updates the URL,
  // while user navigation above remains the only code path that opens a session.
  useEffect(() => {
    if (!ready || projectsLoading || resolvingUrl || hasLegacyDeepLink) return;
    if (pendingSelfNavRef.current !== undefined) return;
    if (urlKey && resolvedKeyRef.current !== urlKey) return;
    const current = projects.find((project) => project.id === currentProjectId);
    if (urlKey) {
      const matches =
        current?.appId === urlKey ||
        current?.id === urlKey ||
        (UUID_RE.test(urlKey) && currentProjectId === urlKey);
      if (!matches) return;
    }
    const canonical = current?.appId || currentProjectId;
    if (canonical === (urlKey ?? null)) return;
    if (!canonical) {
      resolvedKeyRef.current = null;
      pendingSelfNavRef.current = null;
      navigate('/create', { replace: true });
      return;
    }
    const urlProject = urlKey
      ? projects.find((project) => project.appId === urlKey || project.id === urlKey)
      : undefined;
    const sameProject = !urlKey || urlProject?.id === currentProjectId;
    resolvedKeyRef.current = canonical;
    pendingSelfNavRef.current = canonical;
    navigate(`/create/${canonical}`, { replace: sameProject });
  }, [
    urlKey,
    ready,
    projectsLoading,
    resolvingUrl,
    hasLegacyDeepLink,
    projects,
    currentProjectId,
    navigate,
  ]);

  return { currentProject, navigateToProject, resolvingUrl };
}
