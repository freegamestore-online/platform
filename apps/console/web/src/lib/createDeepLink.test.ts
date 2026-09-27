import { describe, expect, it } from 'vitest';
import { resolveLegacyDeepLink } from './createDeepLink';

describe('resolveLegacyDeepLink', () => {
  it('migrates game links and preserves the fresh-chat intent', () => {
    expect(resolveLegacyDeepLink(new URLSearchParams('game=ocean-save&fresh=1'))).toEqual({
      kind: 'open-game',
      gameId: 'ocean-save',
      fresh: true,
    });
  });

  it('migrates draft-session links without importing a game', () => {
    expect(resolveLegacyDeepLink(new URLSearchParams('session=draft-123'))).toEqual({
      kind: 'open-session',
      sessionId: 'draft-123',
    });
  });

  it('does nothing for canonical URLs', () => {
    expect(resolveLegacyDeepLink(new URLSearchParams())).toEqual({ kind: 'none' });
  });
});
