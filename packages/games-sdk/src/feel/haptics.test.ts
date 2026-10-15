import { describe, expect, it, vi } from 'vitest';
import { HAPTICS, vibrate } from './haptics.js';

describe('vibrate', () => {
  it('passes the pattern to the Vibration API and reports success', () => {
    const nav = { vibrate: vi.fn().mockReturnValue(true) };
    expect(vibrate([10, 20, 30], nav)).toBe(true);
    expect(nav.vibrate).toHaveBeenCalledWith([10, 20, 30]);
  });

  it('does nothing and reports false where the API is missing', () => {
    expect(vibrate(10, {} as Pick<Navigator, 'vibrate'>)).toBe(false);
    expect(vibrate(10, undefined)).toBe(false);
  });
});

describe('HAPTICS', () => {
  it.each(Object.entries(HAPTICS))('%s is a short, valid pattern', (_name, pattern) => {
    const steps = typeof pattern === 'number' ? [pattern] : pattern;
    expect(steps.every((ms) => Number.isInteger(ms) && ms >= 0)).toBe(true);
    expect(steps.reduce((sum, ms) => sum + ms, 0)).toBeLessThanOrEqual(300);
  });

  it('makes game over heavier than a match clear', () => {
    const total = (p: readonly number[]) => p.reduce((sum, ms) => sum + ms, 0);
    expect(total(HAPTICS.gameOver)).toBeGreaterThan(total(HAPTICS.clear));
  });
});
