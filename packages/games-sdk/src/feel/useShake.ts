import { useCallback, type RefObject } from 'react';
import { prefersReducedMotion } from './reducedMotion.js';
import { shakeKeyframes } from './shake.js';

export interface ShakeOptions {
  /** Peak offset in px. Keep it small: a few pixels reads as impact, more reads as a glitch. */
  amplitude?: number;
  /** Length of the shake in ms. */
  duration?: number;
}

/**
 * A function that shakes the element behind `ref`. It uses the Web Animations API,
 * so nothing re-renders and the animation runs on the compositor. It does nothing
 * under reduced motion, or where `element.animate` is missing.
 */
export function useShake<T extends HTMLElement>(
  ref: RefObject<T | null>,
  { amplitude = 4, duration = 320 }: ShakeOptions = {},
): () => void {
  return useCallback(() => {
    const element = ref.current;
    if (!element || prefersReducedMotion() || typeof element.animate !== 'function') return;
    element.animate(shakeKeyframes(amplitude), { duration, easing: 'ease-out' });
  }, [ref, amplitude, duration]);
}
