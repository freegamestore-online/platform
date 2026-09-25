import { describe, expect, it } from 'vitest';
import { registryToRepo } from './_games';

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
    expect(registryToRepo({ id: 'chess-remix', forkedFrom: attribution }, true).forkedFrom).toEqual(
      attribution,
    );
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
      ).forkedFrom,
    ).toBe('deleted-source');
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
