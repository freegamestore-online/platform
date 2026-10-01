import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../hooks/useProjects';
import { queueInitialBuild, readInitialBuild } from '../lib/initialBuild';

// #76: after creating a game, Create auto-sends the queued first-build prompt.
// The queued entry (localStorage) was only cleared once a live/error deploy
// phase was seen in the SAME page session, and the send didn't wait for the
// transcript — so a reload/revisit mid-build re-sent the whole prompt.

const h = vi.hoisted(() => ({
  agent: null as unknown as Record<string, unknown>,
  sendMessage: vi.fn(),
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

const SESSION = '0b6f2f9e-3c1d-4b8a-9e2f-1a2b3c4d5e6f';
const PROMPT = 'Build the first playable version of Space Rescue.';
const game: Project = {
  id: SESSION,
  name: 'Space Rescue',
  createdAt: new Date(0).toISOString(),
  updatedAt: 0,
  deployed: false,
  appId: 'space-rescue',
};
const GREETING = { role: 'assistant', content: 'Describe the game you want to build.' };

function makeAgent(overrides: Record<string, unknown> = {}) {
  return {
    projects: [game],
    currentProjectId: SESSION,
    projectsLoading: false,
    projectsError: false,
    isStreaming: false,
    historyLoaded: true,
    messages: [GREETING],
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
    sendMessage: h.sendMessage,
    dismissError: vi.fn(),
    showEarlier: vi.fn(),
    ...overrides,
  };
}

const ui = () => (
  <MemoryRouter initialEntries={['/create/space-rescue']}>
    <Routes>
      <Route path="/create/:id" element={<Create />} />
    </Routes>
  </MemoryRouter>
);

/** Let effects (provider resolution, auto-send) settle. */
const settle = () => act(async () => {});

beforeEach(() => {
  localStorage.clear();
  h.sendMessage.mockReset();
});
afterEach(cleanup);

describe('first-build auto-send (#76)', () => {
  it('does not send before the session history has loaded', async () => {
    queueInitialBuild('space-rescue', PROMPT);
    h.agent = makeAgent({ historyLoaded: false });
    render(ui());
    await settle();
    expect(h.sendMessage).not.toHaveBeenCalled();
    expect(readInitialBuild('space-rescue')).not.toBeNull(); // still queued
  });

  it('sends once history is loaded and clears the queued entry immediately', async () => {
    queueInitialBuild('space-rescue', PROMPT);
    h.agent = makeAgent();
    render(ui());
    await settle();
    expect(h.sendMessage).toHaveBeenCalledOnce();
    expect(h.sendMessage.mock.calls[0]?.[0]).toBe(PROMPT);
    // Cleared on send — not left until a live/error phase is seen in this tab.
    expect(readInitialBuild('space-rescue')).toBeNull();
  });

  it('does not re-send on a reload after the prompt was sent', async () => {
    queueInitialBuild('space-rescue', PROMPT);
    h.agent = makeAgent();
    const first = render(ui());
    await settle();
    expect(h.sendMessage).toHaveBeenCalledOnce();
    first.unmount(); // reload: refs and component state are gone

    h.agent = makeAgent({ historyLoaded: false });
    const second = render(ui());
    await settle();
    h.agent = makeAgent({ historyLoaded: true });
    second.rerender(ui());
    await settle();
    expect(h.sendMessage).toHaveBeenCalledOnce();
  });

  it('clears a leftover entry without re-sending once history shows the prompt was sent', async () => {
    // The entry survived (e.g. sent by an older client that never cleared it).
    queueInitialBuild('space-rescue', PROMPT);
    h.agent = makeAgent({ historyLoaded: false });
    const view = render(ui());
    await settle();
    expect(h.sendMessage).not.toHaveBeenCalled();

    h.agent = makeAgent({
      historyLoaded: true,
      messages: [GREETING, { role: 'user', content: PROMPT }],
    });
    view.rerender(ui());
    await settle();
    expect(h.sendMessage).not.toHaveBeenCalled();
    expect(readInitialBuild('space-rescue')).toBeNull();
  });
});
