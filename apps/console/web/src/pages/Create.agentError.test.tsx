import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

// #78: the Studio is the one page that needs the agent session. When the
// handoff failed it must say so and offer a retry, not fail every agent call.

const h = vi.hoisted(() => ({ retry: vi.fn() }));
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { sub: 'github:1' },
    loading: false,
    signIn: vi.fn(),
    agentError: "Couldn't connect to the AI studio. Please try again.",
    retryAgentSession: h.retry,
  }),
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
vi.mock('../hooks/useAgent', () => ({
  useAgent: () => ({
    projects: [],
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
    openGame: vi.fn().mockResolvedValue(null),
    switchProject: vi.fn(),
    startFreshChat: vi.fn(),
    deleteProject: vi.fn(),
    reloadProjects: vi.fn(),
    loadHistory: vi.fn(),
    sendMessage: vi.fn(),
    dismissError: vi.fn(),
    showEarlier: vi.fn(),
  }),
}));
vi.mock('../components/Nav', () => ({ Nav: () => null }));

import { Create } from './Create';

afterEach(cleanup);

describe('Studio with a failed agent handoff (#78)', () => {
  it('shows the failure with a retry that re-attempts the handoff', () => {
    render(
      <MemoryRouter initialEntries={['/create']}>
        <Routes>
          <Route path="/create" element={<Create />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText(/couldn't connect to the ai studio/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(h.retry).toHaveBeenCalledOnce();
  });
});
