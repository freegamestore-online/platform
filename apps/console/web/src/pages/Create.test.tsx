import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../hooks/useProjects';

// Shared, mutable mock state (hoisted so the vi.mock factory can close over it).
const h = vi.hoisted(() => ({
  agent: null as unknown as Record<string, unknown>,
  openGame: vi.fn<(id: string) => Promise<string | null>>(),
  switchProject: vi.fn(),
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { sub: 'github:1' }, loading: false, signIn: vi.fn() }),
}));
vi.mock('../hooks/useKeys', () => ({
  useKeys: () => ({
    hasKey: () => true,
    providerUsable: () => true,
    loading: false,
    providers: new Set<string>(),
    saveKey: vi.fn(),
    removeKey: vi.fn(),
    refresh: vi.fn(),
  }),
}));
vi.mock('../hooks/useAgent', () => ({ useAgent: () => h.agent }));

import { Create } from './Create';

function makeAgent(overrides: Record<string, unknown> = {}) {
  return {
    projects: [] as Project[],
    currentProjectId: null,
    projectsLoading: false,
    projectsError: false,
    isStreaming: false,
    messages: [],
    deployState: null,
    error: null,
    tokensIn: 0,
    tokensOut: 0,
    visibleCount: 20,
    openGame: h.openGame,
    switchProject: h.switchProject,
    startFreshChat: vi.fn(),
    deleteProject: vi.fn(),
    reloadProjects: vi.fn(),
    loadHistory: vi.fn(),
    sendMessage: vi.fn(),
    dismissError: vi.fn(),
    showEarlier: vi.fn(),
    ...overrides,
  };
}

const gameA: Project = {
  id: 'sess-a',
  name: 'Game A',
  createdAt: new Date(0).toISOString(),
  updatedAt: 0,
  deployed: true,
  appId: 'game-a',
  appUrl: 'https://game-a.freegamestore.online',
};

function Loc() {
  return <div data-testid="loc">{useLocation().pathname}</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Loc />
      <Link to="/create/beat-star2" data-testid="retry">
        retry
      </Link>
      <Routes>
        <Route path="/create/:id" element={<Create />} />
        <Route path="/create" element={<Create />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  h.openGame.mockReset();
  h.switchProject.mockReset();
});
afterEach(cleanup);

const gameB: Project = {
  id: 'sess-b',
  name: 'Game B',
  createdAt: new Date(0).toISOString(),
  updatedAt: 0,
  deployed: true,
  appId: 'game-b',
  appUrl: 'https://game-b.freegamestore.online',
};

const gameC: Project = {
  id: 'sess-c',
  name: 'Game C',
  createdAt: new Date(0).toISOString(),
  updatedAt: 0,
  deployed: true,
  appId: 'game-c',
  appUrl: 'https://game-c.freegamestore.online',
};

describe('Create — opening a game via /create/:id', () => {
  it('attempts to open the game named in the path', async () => {
    h.openGame.mockResolvedValue('sess-new');
    h.agent = makeAgent({ projects: [gameA], currentProjectId: 'sess-a' });
    renderAt('/create/beat-star2');
    await waitFor(() => expect(h.openGame).toHaveBeenCalledWith('beat-star2'));
  });

  it("FIX: a failed open reverts the URL to the game that's actually open (no silent mismatch)", async () => {
    // beat-star2 can't be opened (404/403). Before the fix the address bar stayed
    // on /create/beat-star2 while the studio still showed game-a — so the next
    // prompt would have edited game-a. The URL must snap back to game-a.
    h.openGame.mockResolvedValue(null);
    h.agent = makeAgent({ projects: [gameA], currentProjectId: 'sess-a' });
    renderAt('/create/beat-star2');
    await waitFor(() => expect(h.openGame).toHaveBeenCalledWith('beat-star2'));
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/create/game-a'));
  });

  it('FIX: after a failed open, selecting the same game again RETRIES (latch not stuck)', async () => {
    h.openGame.mockResolvedValue(null);
    h.agent = makeAgent({ projects: [gameA], currentProjectId: 'sess-a' });
    renderAt('/create/beat-star2');
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/create/game-a'));
    expect(h.openGame).toHaveBeenCalledTimes(1);

    // Re-navigate to the same failed game (as clicking it again in My Games would).
    fireEvent.click(screen.getByTestId('retry'));
    await waitFor(() => expect(h.openGame).toHaveBeenCalledTimes(2));
  });

  it('no regression: a SUCCESSFUL open does not revert the URL', async () => {
    h.openGame.mockResolvedValue('sess-new');
    h.agent = makeAgent({ projects: [gameA], currentProjectId: 'sess-a' });
    renderAt('/create/beat-star2');
    await waitFor(() => expect(h.openGame).toHaveBeenCalledWith('beat-star2'));
    // Give any errant navigation a chance to run, then assert we stayed put.
    await Promise.resolve();
    expect(screen.getByTestId('loc').textContent).toBe('/create/beat-star2');
  });

  it('RACE FIX (#4): a superseded openGame (null from useAgent) does not revert the URL to a stale revertKey', async () => {
    // Scenario: user is on game-a (/create/game-a), navigates to game-b
    // (/create/game-b), openGame("game-b") starts. Before it resolves the user
    // switches BACK to game-a (or to a third game). openGame("game-b") completes
    // but returns null (superseded). The routing effect's .then() fires with
    // openedId=null and uses the synchronously-captured revertKey ("game-a").
    // Navigating to /create/game-a is a no-op since the user is already there —
    // so the URL and session must agree on game-a.
    //
    // The pre-fix bug: the .then() read currentProject from the stale closure
    // (the render when the effect last fired, which could be game-b or something
    // else entirely), leading to an incorrect back-navigation.
    //
    // We simulate openGame returning null (as useAgent.openGame does when the
    // underlying openGame throws OpenSupersededError) and verify the URL does
    // not get corrupted.
    let resolveOpen!: (id: null) => void;
    const deferredOpen = new Promise<null>((res) => {
      resolveOpen = res;
    });
    h.openGame.mockReturnValue(deferredOpen);

    // Start on game-a, navigate to game-b via URL.
    h.agent = makeAgent({ projects: [gameA, gameB], currentProjectId: 'sess-a' });
    renderAt('/create/game-b');

    // Routing effect fires and calls openGame("game-b") — still in flight.
    await waitFor(() => expect(h.openGame).toHaveBeenCalledWith('game-b'));
    // URL is currently /create/game-b (the route we navigated to).
    expect(screen.getByTestId('loc').textContent).toBe('/create/game-b');

    // Now resolve the deferred openGame with null (superseded / failed).
    // The revertKey captured before the call was "game-a" (the open project at
    // the time the routing effect fired), so navigate should go to /create/game-a.
    await act(async () => {
      resolveOpen(null);
    });

    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/create/game-a'));
  });

  it('FIX (#5): a superseded openGame null does NOT revert the URL when the user switched away via the picker', async () => {
    // Scenario: user is on game-a (/create/game-a), navigates to game-b
    // (/create/game-b), openGame("game-b") starts. While it is still in flight
    // the user uses the picker to switch to game-c — navigateToProject updates
    // resolvedKeyRef to "game-c" and pushes /create/game-c. Then
    // openGame("game-b") resolves with null (OpenSupersededError → null in
    // useAgent). Before the #5 fix the .then() revert guard was missing, so the
    // stale callback would navigate back to /create/game-a. With the fix the
    // guard `resolvedKeyRef.current !== urlKey` catches the mismatch and the URL
    // stays on /create/game-c. See issue #5.
    //
    // Test design: openGame for game-b resolves null (superseded). Any other
    // gameId (game-a, game-c) gets a NEVER-resolving deferred so that if a
    // spurious navigate to /create/game-a fires the URL stays there and the
    // final assertion catches the regression.

    let resolveGameB!: (id: null) => void;
    const deferredGameB = new Promise<null>((res) => {
      resolveGameB = res;
    });
    const neverResolve = new Promise<null>(() => {
      /* intentionally never resolves */
    });

    h.openGame.mockImplementation((id: string) => (id === 'game-b' ? deferredGameB : neverResolve));

    // Start on game-a, navigate to game-b via URL. Agent has game-a open.
    h.agent = makeAgent({ projects: [gameA, gameB, gameC], currentProjectId: 'sess-a' });
    render(
      <MemoryRouter initialEntries={['/create/game-b']}>
        <Loc />
        <Link to="/create/game-c" data-testid="switch-to-c">
          switch to c
        </Link>
        <Routes>
          <Route path="/create/:id" element={<Create />} />
          <Route path="/create" element={<Create />} />
        </Routes>
      </MemoryRouter>,
    );

    // Routing effect fires and calls openGame("game-b") — still in flight.
    await waitFor(() => expect(h.openGame).toHaveBeenCalledWith('game-b'));
    expect(screen.getByTestId('loc').textContent).toBe('/create/game-b');

    // Simulate picker switch to game-c: update currentProjectId to sess-c so
    // the routing effect for urlKey="game-c" sees project.id===currentProjectId
    // and returns early after setting resolvedKeyRef.current="game-c".
    h.agent = makeAgent({ projects: [gameA, gameB, gameC], currentProjectId: 'sess-c' });
    fireEvent.click(screen.getByTestId('switch-to-c'));
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/create/game-c'));

    // resolvedKeyRef.current is now "game-c". Resolve the stale openGame("game-b")
    // with null (superseded). The guard `resolvedKeyRef.current !== urlKey` must
    // suppress the revert. Any incorrect navigate to /create/game-a would then
    // fire openGame("game-a") which never resolves, leaving the URL stuck at
    // /create/game-a — so the final assertion would fail without the fix.
    await act(async () => {
      resolveGameB(null);
    });

    await Promise.resolve();
    expect(screen.getByTestId('loc').textContent).toBe('/create/game-c');
  });
});
