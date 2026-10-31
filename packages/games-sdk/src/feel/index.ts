/**
 * The feel kit: particles, tweens and easing, shake, haptics and score pop-ups.
 * Every export is a separate module with no side effects on import, so a bundler
 * keeps only what a game uses. Import it from `@freegamestore/games/feel`, or
 * from the package root.
 */

export {
  type Easing,
  easeInOutQuad,
  easeInQuad,
  easeOutBack,
  easeOutCubic,
  easeOutQuad,
  linear,
} from './easing.js';
export { HAPTICS, type VibrationPattern, vibrate } from './haptics.js';
export {
  type BurstOptions,
  createBurst,
  GRAVITY,
  MAX_PARTICLES,
  type Particle,
  particleAlpha,
  stepParticles,
} from './particles.js';
export { prefersReducedMotion } from './reducedMotion.js';
export { SCORE_POP_MS, ScorePopup, type ScorePopupProps } from './ScorePopup.js';
export { shakeKeyframes } from './shake.js';
export { tweenProgress, tweenValue } from './tween.js';
export { type Haptics, useHaptics } from './useHaptics.js';
export { type ParticleEmitter, useParticles } from './useParticles.js';
export { type ShakeOptions, useShake } from './useShake.js';
