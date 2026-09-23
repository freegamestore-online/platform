import { describe, expect, it } from 'vitest';
import { isAllowedOrigin, isValidScore, sanitizeName, withinCap } from './index';

// Unit tests for pure helpers in the leaderboard worker. These import the REAL
// functions from ./index so the tests fail if the runtime logic drifts — the
// previous version re-implemented each helper inline here, giving only illusory
// coverage that could pass while the real code changed.

describe('CORS origin check', () => {
  it('allows game subdomains', () => {
    expect(isAllowedOrigin('https://chess.freegamestore.online')).toBe(true);
    expect(isAllowedOrigin('https://tetris.freegamestore.online')).toBe(true);
  });

  it('allows the store root', () => {
    expect(isAllowedOrigin('https://freegamestore.online')).toBe(true);
  });

  it('allows localhost dev', () => {
    expect(isAllowedOrigin('http://localhost:5173')).toBe(true);
  });

  it('rejects unknown origins', () => {
    expect(isAllowedOrigin('https://evil.com')).toBe(false);
    expect(isAllowedOrigin('https://freegamestore.online.evil.com')).toBe(false);
  });
});

describe('score validation', () => {
  const MAX_SCORE = 999_999_999;

  it('accepts zero and positive integers', () => {
    expect(isValidScore(0)).toBe(true);
    expect(isValidScore(1000)).toBe(true);
    expect(isValidScore(MAX_SCORE)).toBe(true);
  });

  it('rejects negatives, floats, strings, and overflow', () => {
    expect(isValidScore(-1)).toBe(false);
    expect(isValidScore(1.5)).toBe(false);
    expect(isValidScore('100')).toBe(false);
    expect(isValidScore(MAX_SCORE + 1)).toBe(false);
  });
});

describe('per-game score cap', () => {
  const MAX_SCORE = 999_999_999;

  it('rejects a forged high score on a bounded game', () => {
    expect(withinCap('simon', 999_999_999)).toBe(false);
    expect(withinCap('simon', 1000)).toBe(true);
    expect(withinCap('simon', 1001)).toBe(false);
  });

  it('allows large-but-plausible scores under the per-game cap', () => {
    expect(withinCap('2048', 5_000_000)).toBe(true);
    expect(withinCap('2048', 5_000_001)).toBe(false);
  });

  it('falls back to the global max for unlisted games', () => {
    expect(withinCap('chess', MAX_SCORE)).toBe(true);
    expect(withinCap('chess', 12345)).toBe(true);
  });
});

describe('name sanitisation', () => {
  it('trims and caps at 20 chars', () => {
    expect(sanitizeName('  Alice  ')).toBe('Alice');
    expect(sanitizeName('A'.repeat(30))).toHaveLength(20);
  });

  it('strips HTML-special chars', () => {
    expect(sanitizeName('<script>')).toBe('script');
    expect(sanitizeName("O'Brien")).toBe('OBrien');
  });

  it('falls back to Anonymous for blanks and non-strings', () => {
    expect(sanitizeName('')).toBe('Anonymous');
    expect(sanitizeName('   ')).toBe('Anonymous');
    expect(sanitizeName(null)).toBe('Anonymous');
  });
});
