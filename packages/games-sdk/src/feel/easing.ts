/**
 * Easing curves. Each maps progress t in [0, 1] to an eased progress, with
 * 0 → 0 and 1 → 1. Pure functions, so they can be used anywhere and tree-shaken.
 */
export type Easing = (t: number) => number;

export const linear: Easing = (t) => t;

export const easeInQuad: Easing = (t) => t * t;

/** Starts fast and settles. The default for entrances and moves. */
export const easeOutQuad: Easing = (t) => 1 - (1 - t) * (1 - t);

export const easeOutCubic: Easing = (t) => 1 - (1 - t) ** 3;

export const easeInOutQuad: Easing = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** Overshoots its target and settles back, a light spring. Use it for pops, not for long moves. */
export function easeOutBack(overshoot = 1.70158): Easing {
  const c3 = overshoot + 1;
  return (t) => 1 + c3 * (t - 1) ** 3 + overshoot * (t - 1) ** 2;
}
