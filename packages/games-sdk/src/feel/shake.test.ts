import { describe, expect, it } from 'vitest';
import { shakeKeyframes } from './shake.js';

const offsetOf = (frame: Keyframe) => Number.parseFloat(String(frame.transform).match(/translate3d\((-?[\d.]+)px/)?.[1] ?? '0');

describe('shakeKeyframes', () => {
  it('starts and ends at rest', () => {
    const frames = shakeKeyframes(4);
    expect(frames[0]!.offset).toBe(0);
    expect(frames.at(-1)!.transform).toBe('translate3d(0, 0, 0)');
    expect(frames.at(-1)!.offset).toBe(1);
  });

  it('swings to the given amplitude first, then decays', () => {
    const frames = shakeKeyframes(4);
    const swings = frames.slice(1, -1).map((frame) => Math.abs(offsetOf(frame)));
    expect(swings[0]).toBe(4);
    for (let i = 1; i < swings.length; i++) {
      expect(swings[i]).toBeLessThan(swings[i - 1]!);
    }
  });

  it('scales with the amplitude', () => {
    const small = shakeKeyframes(2).slice(1, -1).map(offsetOf);
    const large = shakeKeyframes(8).slice(1, -1).map(offsetOf);
    small.forEach((value, i) => expect(large[i]).toBeCloseTo(value * 4, 9));
  });
});
