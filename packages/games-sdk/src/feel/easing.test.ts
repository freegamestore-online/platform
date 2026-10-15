import { describe, expect, it } from 'vitest';
import { easeInOutQuad, easeInQuad, easeOutBack, easeOutCubic, easeOutQuad, linear } from './easing.js';

const CURVES = { linear, easeInQuad, easeOutQuad, easeOutCubic, easeInOutQuad, easeOutBack: easeOutBack() };

describe('easing curves', () => {
  it.each(Object.entries(CURVES))('%s starts at 0 and ends at 1', (_name, ease) => {
    expect(ease(0)).toBeCloseTo(0, 9);
    expect(ease(1)).toBeCloseTo(1, 9);
  });

  it.each([
    ['easeInQuad', easeInQuad],
    ['easeOutQuad', easeOutQuad],
    ['easeOutCubic', easeOutCubic],
    ['linear', linear],
  ])('%s never goes backwards', (_name, ease) => {
    let last = -Infinity;
    for (let i = 0; i <= 20; i++) {
      const value = ease(i / 20);
      expect(value).toBeGreaterThanOrEqual(last - 1e-12);
      last = value;
    }
  });

  it('easeOutQuad is ahead of linear at the midpoint, and easeInQuad is behind', () => {
    expect(easeOutQuad(0.5)).toBeGreaterThan(0.5);
    expect(easeInQuad(0.5)).toBeLessThan(0.5);
  });

  it('easeOutBack overshoots its target before it settles', () => {
    const back = easeOutBack();
    const peak = Math.max(...Array.from({ length: 21 }, (_, i) => back(i / 20)));
    expect(peak).toBeGreaterThan(1);
  });
});
