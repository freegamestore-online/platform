/**
 * Keyframes for a short, decaying shake: a few side-to-side swings that shrink to rest.
 * Pure, so the motion can be checked on its own and passed to `element.animate`.
 */
export function shakeKeyframes(amplitude: number): Keyframe[] {
  const a = amplitude;
  return [
    { transform: 'translate3d(0, 0, 0)', offset: 0 },
    { transform: `translate3d(${-a}px, 0, 0)`, offset: 0.15 },
    { transform: `translate3d(${a * 0.8}px, 0, 0)`, offset: 0.3 },
    { transform: `translate3d(${-a * 0.6}px, 0, 0)`, offset: 0.45 },
    { transform: `translate3d(${a * 0.4}px, 0, 0)`, offset: 0.6 },
    { transform: `translate3d(${-a * 0.2}px, 0, 0)`, offset: 0.8 },
    { transform: 'translate3d(0, 0, 0)', offset: 1 },
  ];
}
