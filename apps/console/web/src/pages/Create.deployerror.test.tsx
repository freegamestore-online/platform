import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../hooks/useProjects';
import { RETRY_DEPLOY_PROMPT } from '../lib/deployError';

/**
 * Issue #20 — a failed deploy has to be readable and recoverable on EVERY
 * viewport. Before this, the error detail lived in DeployLog (inside the
 * `hidden md:flex` preview column) and in the StatusBar's `title` tooltip, so a
 * creator on a phone saw a one-line "Deploy failed" and had no retry path.
 */
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

const project: Project = {
  id: 'sess-a',
  name: 'Game A',
  createdAt: new Date(0).toISOString(),
  updatedAt: 0,
  deployed: true,
  appId: 'game-a',
  appUrl: 'https://game-a.freegamestore.online',
};

function makeAgent(overrides: Record<string, unknown> = {}) {
  return {
    projects: [project],
    currentProjectId: 'sess-a',
    projectsLoading: false,
    projectsError: false,
    isStreaming: false,
    messages: [],
    deployState: null,
    error: null,
    tokensIn: 0,
    tokensOut: 0,
    visibleCount: 20,
    // Must resolve: Create's URL-resolution effect calls .then() on it when the
    // :id param doesn't match an already-open project's appId.
    openGame: vi.fn().mockResolvedValue('sess-a'),
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

function renderStudio() {
  return render(
    <MemoryRouter initialEntries={['/create/game-a']}>
      <Routes>
        <Route path="/create/:id" element={<Create />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  h.sendMessage.mockReset();
});
afterEach(cleanup);

describe('Create — failed deploy is visible and recoverable (#20)', () => {
  it('renders the error detail in the chat column, not only the preview pane', () => {
    h.agent = makeAgent({
      deployState: { phase: 'error', error: 'vite build failed: duplicate declaration' },
      error: 'vite build failed: duplicate declaration',
    });
    renderStudio();
    // The alert must be the NOTICE, not the old one-line banner — the build-logs
    // link only exists in the notice, so it distinguishes the two.
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('duplicate declaration');
    expect(alert.querySelector('a[href*="/actions"]')).not.toBeNull();
  });

  // The banner, the notice and (on desktop) DeployLog all render the same
  // string; stacking them reported one failure three times. The banner's
  // dismiss button is what proves which one is on screen — both carry
  // role="alert", so counting alerts cannot tell them apart.
  it('suppresses the redundant sticky banner while a deploy error is showing', () => {
    h.agent = makeAgent({
      deployState: { phase: 'error', error: 'boom' },
      error: 'boom',
    });
    renderStudio();
    expect(screen.queryByLabelText('Dismiss error')).toBeNull();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('still shows the sticky banner for a non-deploy error', () => {
    h.agent = makeAgent({ deployState: null, error: 'Rate limited by the provider' });
    renderStudio();
    expect(screen.getByText('Rate limited by the provider')).toBeTruthy();
    expect(screen.getByLabelText('Dismiss error')).toBeTruthy();
  });

  it('offers Fix & retry and sends a diagnose-first prompt', () => {
    h.agent = makeAgent({ deployState: { phase: 'error', error: 'boom' } });
    renderStudio();
    fireEvent.click(screen.getByRole('button', { name: /fix & retry/i }));
    expect(h.sendMessage).toHaveBeenCalledTimes(1);
    expect(h.sendMessage).toHaveBeenCalledWith(RETRY_DEPLOY_PROMPT, expect.anything());
  });

  it('hides Fix & retry while the agent is streaming', () => {
    h.agent = makeAgent({ deployState: { phase: 'error', error: 'boom' }, isStreaming: true });
    renderStudio();
    expect(screen.queryByRole('button', { name: /fix & retry/i })).toBeNull();
  });

  it('hides Fix & retry when the game has no id to push to', () => {
    h.agent = makeAgent({
      deployState: { phase: 'error', error: 'boom' },
      projects: [{ ...project, appId: undefined, appUrl: undefined }],
    });
    renderStudio();
    expect(screen.queryByRole('button', { name: /fix & retry/i })).toBeNull();
  });

  // Two matches is correct, not a bug: the chat notice and DeployLog share
  // deployErrorInfo, and jsdom renders the CSS-hidden preview column too.
  it('gives an actionable fallback when the server reports no reason', () => {
    h.agent = makeAgent({ deployState: { phase: 'error', error: '' } });
    renderStudio();
    expect(screen.getAllByText(/didn't report a reason/i).length).toBeGreaterThan(0);
  });

  it("links the game's Actions tab for the build logs", () => {
    h.agent = makeAgent({ deployState: { phase: 'error', error: 'boom' } });
    renderStudio();
    const link = screen.getByRole('link', { name: /view build logs/i });
    expect(link.getAttribute('href')).toBe(
      'https://github.com/freegamestore-online/game-a/actions',
    );
  });

  it('shows nothing extra on a healthy deploy', () => {
    h.agent = makeAgent({
      deployState: { phase: 'live', appUrl: 'https://game-a.freegamestore.online' },
    });
    renderStudio();
    expect(screen.queryByText('Deploy failed')).toBeNull();
    expect(screen.queryByRole('button', { name: /fix & retry/i })).toBeNull();
  });
});
