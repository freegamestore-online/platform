import { describe, expect, it } from 'vitest';
import {
  type BurstOptions,
  createBurst,
  GRAVITY,
  particleAlpha,
  stepParticles,
} from './particles.js';

const OPTIONS: BurstOptions = { count: 6, speed: [100, 200], size: [4, 8], life: 1 };
const fixed = (value: number) => () => value;

describe('createBurst', () => {
  it('emits the requested count from the origin, cycling through the colours', () => {
    const burst = createBurst(10, 20, ['red', 'blue'], OPTIONS, fixed(0.5));

    expect(burst).toHaveLength(6);
    expect(burst.every((p) => p.x === 10 && p.y === 20 && p.age === 0)).toBe(true);
    expect(burst.map((p) => p.colour)).toEqual(['red', 'blue', 'red', 'blue', 'red', 'blue']);
  });

  it('returns nothing when there are no colours to draw with', () => {
    expect(createBurst(0, 0, [], OPTIONS)).toEqual([]);
  });

  it('launches along the given arc: a narrow arc at angle 0 points right', () => {
    const burst = createBurst(0, 0, ['red'], { ...OPTIONS, angle: 0, spread: 0 }, fixed(0.3));
    for (const p of burst) {
      expect(p.vx).toBeGreaterThan(0);
      expect(Math.abs(p.vy)).toBeLessThan(1e-9);
    }
  });

  it('spreads a full radial burst in every direction', () => {
    const burst = createBurst(0, 0, ['red'], { ...OPTIONS, count: 8 });
    expect([
      burst.some((p) => p.vx > 0),
      burst.some((p) => p.vx < 0),
      burst.some((p) => p.vy > 0),
      burst.some((p) => p.vy < 0),
    ]).toEqual([true, true, true, true]);
  });

  it('keeps speed, size and life inside their ranges', () => {
    const low = createBurst(0, 0, ['red'], OPTIONS, fixed(0));
    const high = createBurst(0, 0, ['red'], OPTIONS, fixed(0.999));

    for (const p of [...low, ...high]) {
      const speed = Math.hypot(p.vx, p.vy);
      expect(speed).toBeGreaterThanOrEqual(100 - 1e-9);
      expect(speed).toBeLessThanOrEqual(200 + 1e-9);
      expect(p.size).toBeGreaterThanOrEqual(4);
      expect(p.size).toBeLessThanOrEqual(8);
      expect(p.life).toBeGreaterThanOrEqual(0.75);
      expect(p.life).toBeLessThanOrEqual(1);
    }
  });
});

describe('stepParticles', () => {
  it('moves particles and pulls them down with gravity', () => {
    const [p] = createBurst(
      0,
      0,
      ['red'],
      { ...OPTIONS, count: 1, speed: [100, 100], angle: 0, spread: 0 },
      fixed(0.5),
    );
    stepParticles([p!], 0.1);

    expect(p!.x).toBeCloseTo(p!.vx * 0.1, 6);
    expect(p!.vy).toBeCloseTo(GRAVITY * 0.1, 6);
  });

  it('drops particles past their life and keeps the rest in order', () => {
    const young = { x: 1, y: 0, vx: 0, vy: 0, size: 4, colour: 'a', age: 0, life: 1 };
    const old = { x: 2, y: 0, vx: 0, vy: 0, size: 4, colour: 'b', age: 0.95, life: 1 };
    const also = { x: 3, y: 0, vx: 0, vy: 0, size: 4, colour: 'c', age: 0, life: 1 };
    const list = [young, old, also];

    const result = stepParticles(list, 0.1);

    expect(result).toBe(list);
    expect(result.map((p) => p.colour)).toEqual(['a', 'c']);
  });

  it('empties the list once every particle has expired', () => {
    const burst = createBurst(0, 0, ['red'], OPTIONS, fixed(0.5));
    expect(stepParticles(burst, 10)).toEqual([]);
  });
});

describe('particleAlpha', () => {
  it('is opaque at birth and fades to nothing at the end of its life', () => {
    const particle = { x: 0, y: 0, vx: 0, vy: 0, size: 4, colour: 'a', age: 0, life: 1 };
    expect(particleAlpha(particle)).toBe(1);
    particle.age = 0.5;
    expect(particleAlpha(particle)).toBeCloseTo(0.5, 9);
    particle.age = 2;
    expect(particleAlpha(particle)).toBe(0);
  });
});
