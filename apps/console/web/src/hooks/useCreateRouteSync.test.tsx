import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { type RouteProject, useCreateRouteSync } from './useCreateRouteSync';

const projects: RouteProject[] = [
  { id: 'session-a', appId: 'game-a' },
  { id: 'session-b', appId: 'game-b' },
];

function RouteSync({
  urlKey,
  currentProjectId = 'session-a',
  openGame,
  navigate,
  routeProjects = projects,
}: {
  urlKey?: string;
  currentProjectId?: string | null;
  openGame: (gameId: string) => Promise<string | null>;
  navigate: (path: string, options?: { replace?: boolean }) => void;
  routeProjects?: RouteProject[];
}) {
  useCreateRouteSync({
    urlKey,
    ready: true,
    isStreaming: false,
    projectsLoading: false,
    projects: routeProjects,
    currentProjectId,
    hasLegacyDeepLink: false,
    openGame,
    switchProject: vi.fn(),
    navigate,
  });
  return null;
}

describe('useCreateRouteSync', () => {
  it('opens a deployed game only in response to its URL', async () => {
    const openGame = vi.fn(() => Promise.resolve('session-b'));
    render(<RouteSync urlKey="game-b" openGame={openGame} navigate={vi.fn()} />);
    await waitFor(() => expect(openGame).toHaveBeenCalledWith('game-b'));
    expect(openGame).toHaveBeenCalledTimes(1);
  });

  it('reverts a failed open to the session that was open when navigation began', async () => {
    const navigate = vi.fn();
    render(
      <RouteSync
        urlKey="game-b"
        openGame={vi.fn(() => Promise.resolve(null))}
        navigate={navigate}
      />,
    );
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/create/game-a', { replace: true }));
  });

  it('rewrites a draft route to its deployed game route without opening it again', async () => {
    const navigate = vi.fn();
    const openGame = vi.fn(() => Promise.resolve('session-draft'));
    render(
      <RouteSync
        urlKey="session-draft"
        currentProjectId="session-draft"
        routeProjects={[{ id: 'session-draft', appId: 'live-game' }]}
        openGame={openGame}
        navigate={navigate}
      />,
    );
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/create/live-game', { replace: true }),
    );
    expect(openGame).not.toHaveBeenCalled();
  });
});
