import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistryState, listUserGames, registryToRepo } from './_games';

// #44: console list responses expose rich immutable attribution while retaining
// safe compatibility for legacy #35 strings.
describe('registryToRepo forkedFrom', () => {
  it('passes through the immutable remix snapshot', () => {
    const attribution = {
      id: 'chess',
      name: 'Chess',
      creatorGithub: 'original-creator',
      forkedAt: '2026-09-25T00:00:00.000Z',
    };
    const repo = registryToRepo({ id: 'chess-remix', forkedFrom: attribution }, true, [
      { id: 'chess' },
    ]);
    expect(repo.forkedFrom).toEqual(attribution);
    expect(repo.forkedFromSourceAvailable).toBe(true);
  });

  it('normalizes a legacy source id when registry facts are complete', () => {
    const registry = [
      { id: 'chess', name: 'Chess', creatorGithub: 'original-creator' },
      { id: 'chess-remix', forkedFrom: 'chess', firstPublished: '2026-09-25T00:00:00.000Z' },
    ];
    expect(registryToRepo(registry[1]!, true, registry).forkedFrom).toEqual({
      id: 'chess',
      name: 'Chess',
      creatorGithub: 'original-creator',
      forkedAt: '2026-09-25T00:00:00.000Z',
    });
  });

  it('keeps an unresolved legacy source id instead of fabricating a credit', () => {
    expect(
      registryToRepo(
        {
          id: 'chess-remix',
          forkedFrom: 'deleted-source',
          firstPublished: '2026-09-25T00:00:00.000Z',
        },
        true,
        [],
      ),
    ).toMatchObject({ forkedFrom: 'deleted-source', forkedFromSourceAvailable: false });
  });

  it('keeps a legacy id when its historical timestamp is unavailable', () => {
    expect(registryToRepo({ id: 'chess-remix', forkedFrom: 'chess' }, true, []).forkedFrom).toBe(
      'chess',
    );
  });

  it('omits forkedFrom for a game that is not a remix', () => {
    expect(registryToRepo({ id: 'chess' }, true)).not.toHaveProperty('forkedFrom');
  });
});

// #472: a GitHub login is mutable and re-assignable, so "my games" matches the
// registry's creatorGithubId against the session's id first, and only falls
// back to the login for entries (or sessions) that have no id.
describe('listUserGames ownership by GitHub id', () => {
  const registry = {
    games: [
      // Owned by id 100, whose holder has since renamed from `old-name`.
      { id: 'renamed-game', creatorGithub: 'old-name', creatorGithubId: '100' },
      // Owned by id 200; its login was freed and re-registered by id 100.
      { id: 'reused-login', creatorGithub: 'new-name', creatorGithubId: '200' },
      // Legacy entry with no id: the login decides.
      { id: 'legacy-game', creatorGithub: 'new-name' },
    ],
  };

  function stubGitHub() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/contents/sites/freegamestore/registry.json'))
          return Response.json(registry);
        if (url.includes('/members/')) return new Response(null, { status: 404 });
        return Response.json({});
      }),
    );
  }

  afterEach(() => vi.unstubAllGlobals());

  it('matches on the id when both sides carry one, ignoring the login', async () => {
    stubGitHub();
    const { owned } = await listUserGames({ GITHUB_TOKEN: 't' }, 'new-name', '100');
    expect(owned.map((g) => g.id).sort()).toEqual(['legacy-game', 'renamed-game']);
  });

  it('falls back to the login when the session has no GitHub id', async () => {
    stubGitHub();
    const { owned } = await listUserGames({ GITHUB_TOKEN: 't' }, 'new-name');
    expect(owned.map((g) => g.id).sort()).toEqual(['legacy-game', 'reused-login']);
  });
});

// #480: the live registry is the platform monorepo's sites/freegamestore copy;
// the old `freegamestore` repo is archived and stale.
describe('getRegistryState location', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads the platform registry (Contents API first, raw fallback), never the archived repo', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        return new Response('down', { status: 500 });
      }),
    );
    await getRegistryState('t');
    expect(urls).toEqual([
      'https://api.github.com/repos/freegamestore-online/platform/contents/sites/freegamestore/registry.json',
      'https://raw.githubusercontent.com/freegamestore-online/platform/main/sites/freegamestore/registry.json',
    ]);
  });
});
