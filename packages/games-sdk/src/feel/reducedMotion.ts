/**
 * True when the player has asked the system for less motion. Safe to call where
 * `matchMedia` is missing (server render, jsdom, old browsers), where it returns false.
 */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}
