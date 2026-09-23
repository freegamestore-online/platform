import { describe, expect, it } from 'vitest';
import { registryToRepo } from './_games';

// Remix lineage (#35): the registry's forkedFrom must survive into the game
// list the console serves, so attribution can be added without a migration.
describe('registryToRepo forkedFrom', () => {
  it('passes through the remix source', () => {
    expect(registryToRepo({ id: 'chess-remix', forkedFrom: 'chess' }, true).forkedFrom).toBe(
      'chess',
    );
  });

  it('omits forkedFrom for a game that is not a remix', () => {
    expect(registryToRepo({ id: 'chess' }, true)).not.toHaveProperty('forkedFrom');
  });
});
