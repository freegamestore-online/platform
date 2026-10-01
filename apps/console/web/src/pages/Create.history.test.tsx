import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../hooks/useProjects';

// #75: a2bc968 moved Create's route handling into hooks and dropped the effect
// that called agent.loadHistory() when the open project changed. Opening a game
// (My Games, picker, URL) or reloading /create/<id> showed an empty chat: the
// transcript, deploy state and token totals were never restored.

const h = vi.hoisted(() => ({ agent: null as unknown as Record<string, unknown> }));
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

const SESSION = '0b6f2f9e-3c1d-4b8a-9e2f-1a2b3c4d5e6f';
const gameA: Project = {
  id: SESSION,
  name: 'Game A',
  createdAt: new Date(0).toISOString(),
  updatedAt: 0,
  deployed: true,
  appId: 'game-a',
  appUrl: 'https://game-a.freegamestore.online',
};

function makeAgent(overrides: Record<string, unknown> = {}) {
  return {
    projects: [gameA],
    currentProjectId: SESSION,
    projectsLoading: false,
    projectsError: false,
    isStreaming: false,
    messages: [],
    deployState: null,
    error: null,
    tokensIn: 0,
    tokensOut: 0,
    visibleCount: 20,
    openGame: vi.fn().mockResolvedValue(SESSION),
    switchProject: vi.fn(),
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

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/create" element={<Create />} />
        <Route path="/create/:id" element={<Create />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('Studio restores chat history (#75)', () => {
  it('loads history when a game is opened by its URL (/create/<gameId>)', async () => {
    h.agent = makeAgent();
    renderAt('/create/game-a');
    await waitFor(() => expect(h.agent.loadHistory).toHaveBeenCalled());
  });

  it('loads history on reload of a session URL (/create/<sessionId>)', async () => {
    h.agent = makeAgent();
    renderAt(`/create/${SESSION}`);
    await waitFor(() => expect(h.agent.loadHistory).toHaveBeenCalled());
  });

  it('loads history for the open project on /create with no id', async () => {
    h.agent = makeAgent();
    renderAt('/create');
    await waitFor(() => expect(h.agent.loadHistory).toHaveBeenCalled());
  });

  it("does not load another game's history while the URL is still resolving", async () => {
    // URL names game-b, but the open project is still game-a: loading now would
    // paint game-a's transcript under game-b's URL.
    h.agent = makeAgent({ openGame: vi.fn(() => new Promise(() => {})) });
    renderAt('/create/game-b');
    await new Promise((r) => setTimeout(r, 50));
    expect(h.agent.loadHistory).not.toHaveBeenCalled();
  });

  it('waits for the project list before loading', async () => {
    h.agent = makeAgent({ projectsLoading: true });
    renderAt(`/create/${SESSION}`);
    await new Promise((r) => setTimeout(r, 50));
    expect(h.agent.loadHistory).not.toHaveBeenCalled();
  });
});
