import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLegacyDeepLinkMigration } from './useLegacyDeepLinkMigration';

function Migration({
  params,
  openGame,
  startFreshChat,
  switchProject,
  clear,
}: {
  params: string;
  openGame: (gameId: string) => Promise<unknown>;
  startFreshChat: (gameId: string) => Promise<unknown>;
  switchProject: (sessionId: string) => void;
  clear: () => void;
}) {
  useLegacyDeepLinkMigration({
    params: new URLSearchParams(params),
    ready: true,
    isStreaming: false,
    openGame,
    startFreshChat,
    switchProject,
    clear,
  });
  return null;
}

describe('useLegacyDeepLinkMigration', () => {
  afterEach(cleanup);

  it('opens a game once and clears the legacy params after completion', async () => {
    const openGame = vi.fn(() => Promise.resolve('opened'));
    const clear = vi.fn();
    render(
      <Migration
        params="game=ocean-save"
        openGame={openGame}
        startFreshChat={vi.fn(() => Promise.resolve('fresh'))}
        switchProject={vi.fn()}
        clear={clear}
      />,
    );
    await waitFor(() => expect(openGame).toHaveBeenCalledWith('ocean-save'));
    await waitFor(() => expect(clear).toHaveBeenCalledTimes(1));
  });

  it('uses a fresh chat for fresh game links', async () => {
    const startFreshChat = vi.fn(() => Promise.resolve('fresh'));
    render(
      <Migration
        params="game=ocean-save&fresh=1"
        openGame={vi.fn(() => Promise.resolve('opened'))}
        startFreshChat={startFreshChat}
        switchProject={vi.fn()}
        clear={vi.fn()}
      />,
    );
    await waitFor(() => expect(startFreshChat).toHaveBeenCalledWith('ocean-save'));
  });
});
