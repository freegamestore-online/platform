/**
 * Particle bursts: a pure model with no DOM or canvas, so it can be tested on its own
 * and drawn by any renderer. `useParticles` draws it to a canvas.
 */

/** One particle. Positions and sizes are in CSS pixels, times in seconds. */
export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  colour: string;
  age: number;
  life: number;
}

export interface BurstOptions {
  /** How many particles to emit. */
  count: number;
  /** Launch speed range, in px per second. */
  speed: readonly [number, number];
  /** Square size range, in px. */
  size: readonly [number, number];
  /** Seconds a particle lives. Each one varies by up to a quarter. */
  life: number;
  /** Centre of the launch arc, in radians. 0 points right and π/2 points down. Default 0. */
  angle?: number;
  /** Width of the launch arc, in radians. Default 2π, which is a full radial burst. */
  spread?: number;
}

/** Downward pull, in px per second squared. */
export const GRAVITY = 900;

/** Upper bound on live particles, so a burst on a slow device cannot pile up. */
export const MAX_PARTICLES = 160;

const FALLBACK_COLOUR = '#888888';

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Emit a burst of `options.count` particles from (x, y). Colours are used in
 * turn. `random` returns values in [0, 1), and tests can pass a fixed one.
 */
export function createBurst(
  x: number,
  y: number,
  colours: readonly string[],
  options: BurstOptions,
  random: () => number = Math.random,
): Particle[] {
  if (colours.length === 0) return [];
  const angle = options.angle ?? 0;
  const spread = options.spread ?? Math.PI * 2;
  const particles: Particle[] = [];

  for (let i = 0; i < options.count; i++) {
    const direction = angle + (random() - 0.5) * spread;
    const speed = lerp(options.speed[0], options.speed[1], random());
    particles.push({
      x,
      y,
      vx: Math.cos(direction) * speed,
      vy: Math.sin(direction) * speed,
      size: lerp(options.size[0], options.size[1], random()),
      colour: colours[i % colours.length] ?? FALLBACK_COLOUR,
      age: 0,
      life: options.life * (0.75 + 0.25 * random()),
    });
  }
  return particles;
}

/**
 * Advance every particle by `dt` seconds, drop the ones past their life, and
 * return the survivors. Works in place, so a frame allocates nothing.
 */
export function stepParticles(particles: Particle[], dt: number, gravity = GRAVITY): Particle[] {
  let alive = 0;
  for (const particle of particles) {
    particle.age += dt;
    if (particle.age >= particle.life) continue;
    particle.vy += gravity * dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particles[alive++] = particle;
  }
  particles.length = alive;
  return particles;
}

/** Opacity for a particle: fully opaque when born, fading to nothing at the end of its life. */
export function particleAlpha(particle: Particle): number {
  return Math.max(0, 1 - particle.age / particle.life);
}
