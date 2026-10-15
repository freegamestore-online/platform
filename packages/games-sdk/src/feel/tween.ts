import { easeOutQuad, type Easing } from './easing.js';

/** Progress through a tween, from 0 to 1. Clamped, so a zero duration or a time past the end is safe. */
export function tweenProgress(elapsed: number, duration: number): number {
  if (duration <= 0) return 1;
  return Math.min(1, Math.max(0, elapsed / duration));
}

/**
 * The value of a tween `elapsed` ms into a move from `from` to `to` over `duration` ms.
 * Pure: the caller keeps the clock and decides when to draw the next frame.
 */
export function tweenValue(
  from: number,
  to: number,
  elapsed: number,
  duration: number,
  easing: Easing = easeOutQuad,
): number {
  return from + (to - from) * easing(tweenProgress(elapsed, duration));
}
