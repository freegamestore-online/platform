import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../hooks/useProjects';
import { StudioToolbar } from './StudioToolbar';

// StudioToolbar reads only a handful of fields off the big `agent`/`keys`
// objects — stub exactly those so the render doesn't drag in the real hooks.
function makeAgent(overrides: Record<string, unknown> = {}) {
  return {
    isStreaming: false,
    tokensIn: 0,
    tokensOut: 0,
    projects: [] as Project[],
    currentProjectId: null,
    messages: [],
    ...overrides,
  } as unknown as Parameters<typeof StudioToolbar>[0]['agent'];
}

function makeKeys() {
  return {
    hasKey: () => false,
    providerUsable: () => true,
    saveKey: vi.fn(),
    removeKey: vi.fn(),
    loading: false,
    refresh: vi.fn(),
    providers: new Set<string>(),
  } as unknown as Parameters<typeof StudioToolbar>[0]['keys'];
}

const deployedProject: Project = {
  id: 'sess-1',
  name: 'Beat Star',
  createdAt: new Date(0).toISOString(),
  updatedAt: 0,
  deployed: true,
  appId: 'beat-star',
  appUrl: 'https://beat-star.freegamestore.online',
};

function renderToolbar(props: Partial<Parameters<typeof StudioToolbar>[0]> = {}) {
  const setPickerOpen = vi.fn();
  const base: Parameters<typeof StudioToolbar>[0] = {
    agent: makeAgent(),
    currentProject: deployedProject,
    switching: false,
    provider: 'github',
    setProvider: vi.fn(),
    model: 'gpt-4o',
    setModel: vi.fn(),
    temperature: 0.7,
    setTemperature: vi.fn(),
    settingsOpen: false,
    setSettingsOpen: vi.fn(),
    setPickerOpen,
    keys: makeKeys(),
  };
  const utils = render(
    <MemoryRouter>
      <StudioToolbar {...base} {...props} />
    </MemoryRouter>,
  );
  return { setPickerOpen, ...utils };
}

afterEach(cleanup);

describe('StudioToolbar — game switcher button', () => {
  it('shows the current game name when idle', () => {
    renderToolbar();
    const btn = screen.getByTitle('Switch game');
    expect(btn.textContent).toContain('Beat Star');
    expect(btn.textContent).not.toContain('Loading');
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it("falls back to 'Select game' with no open project", () => {
    renderToolbar({ currentProject: undefined });
    expect(screen.getByTitle('Switch game').textContent).toContain('Select game');
  });

  it('while switching, hides the (stale) game name and shows a Loading state', () => {
    // The whole point of the `switching` prop: during openGame the currentProject
    // still points at the PREVIOUS game, so its name must not be shown.
    renderToolbar({ switching: true });
    const btn = screen.getByTitle('Loading game…');
    expect(btn.textContent).toContain('Loading');
    expect(btn.textContent).not.toContain('Beat Star');
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('is disabled with a build-in-progress hint while streaming', () => {
    renderToolbar({ agent: makeAgent({ isStreaming: true }) });
    const btn = screen.getByTitle('Finish the current build to switch games');
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('opens the picker when clicked while idle', () => {
    const { setPickerOpen } = renderToolbar();
    fireEvent.click(screen.getByTitle('Switch game'));
    expect(setPickerOpen).toHaveBeenCalledWith(true);
  });

  it('does not open the picker while switching (button disabled)', () => {
    const { setPickerOpen } = renderToolbar({ switching: true });
    fireEvent.click(screen.getByTitle('Loading game…'));
    expect(setPickerOpen).not.toHaveBeenCalled();
  });
});

describe('StudioToolbar — game identity + actions', () => {
  it('shows the live game-id chip and Play/Settings for a deployed game', () => {
    renderToolbar();
    // Ground-truth game id chip.
    expect(screen.getByText('beat-star')).toBeTruthy();
    // Play points at the live game URL.
    const play = screen.getByLabelText('Play the live game') as HTMLAnchorElement;
    expect(play.getAttribute('href')).toBe('https://beat-star.freegamestore.online');
    // Settings links into the game route.
    const settings = screen.getByLabelText('Settings for Beat Star') as HTMLAnchorElement;
    expect(settings.getAttribute('href')).toBe('/game/beat-star');
  });

  it('KNOWN GAP: the id chip + Play/Settings still name the STALE game while switching', () => {
    // Documents current behaviour, not desired behaviour: `switching` only swaps
    // the name button — the chip and actions keep pointing at the previous game.
    // If a future change hides these during switching, update this test.
    renderToolbar({ switching: true });
    expect(screen.getByText('beat-star')).toBeTruthy();
    expect(screen.getByLabelText('Play the live game')).toBeTruthy();
  });
});
