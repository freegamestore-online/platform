import { describe, expect, it } from 'vitest';
import { easeInQuad } from './easing.js';
import { tweenProgress, tweenValue } from './tween.js';

describe('tweenProgress', () => {
  it('is the fraction of the duration elapsed, clamped to [0, 1]', () => {
    expect(tweenProgress(50, 100)).toBe(0.5);
    expect(tweenProgress(-10, 100)).toBe(0);
    expect(tweenProgress(250, 100)).toBe(1);
  });

  it('is complete at once for a zero or negative duration', () => {
    expect(tweenProgress(0, 0)).toBe(1);
    expect(tweenProgress(10, -5)).toBe(1);
  });
});

describe('tweenValue', () => {
  it('moves from one value to another over the duration', () => {
    expect(tweenValue(0, 100, 0, 200)).toBe(0);
    expect(tweenValue(0, 100, 200, 200)).toBe(100);
    expect(tweenValue(0, 100, 100, 200, (t) => t)).toBe(50);
  });

  it('applies the easing to the progress, not to the value', () => {
    expect(tweenValue(0, 10, 100, 200, easeInQuad)).toBeCloseTo(2.5, 9);
  });

  it('holds the end value once the duration has passed', () => {
    expect(tweenValue(5, 15, 999, 100)).toBe(15);
  });
});
