import { type RefObject, useEffect, useMemo, useRef } from 'react';
import {
  type BurstOptions,
  createBurst,
  MAX_PARTICLES,
  type Particle,
  particleAlpha,
  stepParticles,
} from './particles.js';
import { prefersReducedMotion } from './reducedMotion.js';

/** Highest device pixel ratio used for the canvas. Higher ratios cost fill time for no visible gain. */
const MAX_DPR = 2;

/** Longest step a single frame may take, in seconds, so a tab switch does not fling particles across the screen. */
const MAX_FRAME_DT = 0.1;

export interface ParticleEmitter {
  /**
   * Launch a burst from (x, y), in the canvas's own CSS-pixel space. Does nothing
   * under reduced motion, or before the canvas is mounted.
   */
  burst(x: number, y: number, colours: readonly string[], options: BurstOptions): void;
}

/**
 * Particle bursts drawn to a full-size canvas. Pass the ref of an `<canvas>`
 * that is positioned over the play area and has `pointer-events: none`. The
 * frame loop runs only while particles are alive, so an idle board costs
 * nothing. The live count is written to `data-particles`, so tests can read it
 * without a re-render per frame.
 */
export function useParticles(canvasRef: RefObject<HTMLCanvasElement | null>): ParticleEmitter {
  const particlesRef = useRef<Particle[]>([]);
  const frameRef = useRef(0);
  const lastRef = useRef<number | null>(null);
  const runningRef = useRef(false);

  useEffect(
    () => () => {
      cancelAnimationFrame(frameRef.current);
      runningRef.current = false;
    },
    [],
  );

  return useMemo<ParticleEmitter>(() => {
    const frame = (now: number) => {
      // The first frame after a burst has no previous time to measure from, so it takes no step.
      const last = lastRef.current;
      const dt = last === null ? 0 : Math.min(Math.max((now - last) / 1000, 0), MAX_FRAME_DT);
      lastRef.current = now;
      const particles = stepParticles(particlesRef.current, dt);
      const canvas = canvasRef.current;
      if (canvas) drawFrame(canvas, particles);
      if (particles.length === 0) {
        runningRef.current = false;
        return;
      }
      frameRef.current = requestAnimationFrame(frame);
    };

    return {
      burst(x, y, colours, options) {
        if (!canvasRef.current || prefersReducedMotion()) return;
        const particles = particlesRef.current;
        particles.push(...createBurst(x, y, colours, options));
        if (particles.length > MAX_PARTICLES) particles.splice(0, particles.length - MAX_PARTICLES);
        if (runningRef.current) return;
        runningRef.current = true;
        lastRef.current = null;
        frameRef.current = requestAnimationFrame(frame);
      },
    };
  }, [canvasRef]);
}

/** Match the backing store to the CSS size, scaled for the screen, then draw one frame. */
function drawFrame(canvas: HTMLCanvasElement, particles: readonly Particle[]): void {
  canvas.dataset.particles = String(particles.length);
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  for (const particle of particles) {
    ctx.globalAlpha = particleAlpha(particle);
    ctx.fillStyle = particle.colour;
    ctx.fillRect(
      particle.x - particle.size / 2,
      particle.y - particle.size / 2,
      particle.size,
      particle.size,
    );
  }
  ctx.globalAlpha = 1;
}
