import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

// #78: a failed agent-session handoff set the shared auth `error`, and the
// Dashboard rendered a dead-end error screen with no retry. Now only identity
// failures block it, and they can be retried in place.

const h = vi.hoisted(() => ({ auth: {} as Record<string, unknown> }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => h.auth }));
vi.mock('../hooks/useDraftSessions', () => ({
  useDraftSessions: () => ({ drafts: [], activity: {}, discard: vi.fn() }),
}));
vi.mock('../components/Nav', () => ({ Nav: () => null }));

import { Dashboard } from './Dashboard';

const base = {
  user: { github: 'octo', avatarUrl: '', githubId: 1, sub: 'github:1' },
  creator: { github: 'octo', games: [], banned: false, maxGames: 10, remaining: 10 },
  creatorError: null,
  loading: false,
  error: null,
  agentError: null,
  refetch: vi.fn(),
  retryAgentSession: vi.fn(),
  fetchCreator: vi.fn(),
  reloadCreator: vi.fn(),
  signIn: vi.fn(),
};

const renderDashboard = () =>
  render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  );

afterEach(cleanup);

describe('Dashboard with auth failures (#78)', () => {
  it('still renders the game list when only the agent handoff failed', () => {
    h.auth = { ...base, agentError: "Couldn't connect to the AI studio. Please try again." };
    renderDashboard();
    expect(screen.queryByText(/couldn't connect to the ai studio/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
  });

  it('offers a working retry when identity could not be loaded', () => {
    const refetch = vi.fn();
    h.auth = { ...base, user: null, creator: null, error: 'Failed to connect to server', refetch };
    renderDashboard();
    expect(screen.getByText('Failed to connect to server')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalledOnce();
  });
});
