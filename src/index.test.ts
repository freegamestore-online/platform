import assert from 'node:assert';
import { describe, it } from 'node:test';
import { PACKAGES } from './index.ts';

describe('platform workspace', () => {
  it('lists all packages', () => {
    assert.ok(PACKAGES.includes('games-sdk'));
    assert.ok(PACKAGES.includes('fgs-cli'));
    assert.ok(PACKAGES.includes('compliance'));
  });
});
