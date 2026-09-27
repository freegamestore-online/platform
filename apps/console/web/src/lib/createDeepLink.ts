/** Legacy query links are migrated once to the canonical /create/:id route. */
export type LegacyDeepLinkAction =
  | { kind: 'open-game'; gameId: string; fresh: boolean }
  | { kind: 'open-session'; sessionId: string }
  | { kind: 'none' };

export function resolveLegacyDeepLink(params: URLSearchParams): LegacyDeepLinkAction {
  const gameId = params.get('game');
  if (gameId) return { kind: 'open-game', gameId, fresh: params.get('fresh') === '1' };
  const sessionId = params.get('session');
  if (sessionId) return { kind: 'open-session', sessionId };
  return { kind: 'none' };
}
