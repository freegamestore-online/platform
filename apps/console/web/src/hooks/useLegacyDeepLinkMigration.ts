import { useEffect, useRef } from 'react';
import { resolveLegacyDeepLink } from '../lib/createDeepLink';

interface LegacyDeepLinkMigrationOptions {
  params: URLSearchParams;
  ready: boolean;
  isStreaming: boolean;
  openGame(gameId: string): Promise<unknown>;
  startFreshChat(gameId: string): Promise<unknown>;
  switchProject(sessionId: string): void;
  clear(): void;
}

/** Executes old ?game= and ?session= links only after session state is ready. */
export function useLegacyDeepLinkMigration({
  params,
  ready,
  isStreaming,
  openGame,
  startFreshChat,
  switchProject,
  clear,
}: LegacyDeepLinkMigrationOptions) {
  const openedGameRef = useRef<string | null>(null);
  const openedSessionRef = useRef<string | null>(null);
  const action = resolveLegacyDeepLink(params);

  useEffect(() => {
    if (!ready || isStreaming || action.kind === 'none') return;
    if (action.kind === 'open-session') {
      if (openedSessionRef.current === action.sessionId) return;
      openedSessionRef.current = action.sessionId;
      switchProject(action.sessionId);
      clear();
      return;
    }
    if (openedGameRef.current === action.gameId) return;
    openedGameRef.current = action.gameId;
    const open = action.fresh ? startFreshChat(action.gameId) : openGame(action.gameId);
    void open.finally(clear);
  }, [action, ready, isStreaming, openGame, startFreshChat, switchProject, clear]);

  return action.kind !== 'none';
}
