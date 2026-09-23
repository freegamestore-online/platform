import { describe, expect, it } from 'vitest';
import { cacheKey } from './kidMode';

describe('kidMode cacheKey', () => {
  it('is stable for identical inputs', () => {
    expect(cacheKey('Hello there', '8', 'funny')).toBe(cacheKey('Hello there', '8', 'funny'));
  });

  it('differs for different messages (collision-resistant)', () => {
    // The old 32-bit hash could collide and serve one message's rewrite for
    // another. Distinct texts must map to distinct keys.
    expect(cacheKey('Move the pawn forward', '8', 'funny')).not.toBe(
      cacheKey('Move the queen forward', '8', 'funny'),
    );
    expect(cacheKey('a', '8', 'funny')).not.toBe(cacheKey('b', '8', 'funny'));
  });

  it('differs when only age or vibe changes', () => {
    expect(cacheKey('same text', '5', 'funny')).not.toBe(cacheKey('same text', '8', 'funny'));
    expect(cacheKey('same text', '8', 'funny')).not.toBe(cacheKey('same text', '8', 'silly'));
  });

  it('differs for texts of different length that a weak hash might collide', () => {
    // Two unrelated strings — the key encodes length + two independent hashes,
    // so a match requires agreeing on all three.
    const a = cacheKey('The cat sat on the mat', '8', 'funny');
    const b = cacheKey('A dog ran in the park!', '8', 'funny');
    expect(a).not.toBe(b);
  });

  it('does not collide across a batch of distinct strings', () => {
    const keys = new Set<string>();
    for (let i = 0; i < 2000; i++) keys.add(cacheKey(`message number ${i}`, '8', 'funny'));
    expect(keys.size).toBe(2000);
  });
});
