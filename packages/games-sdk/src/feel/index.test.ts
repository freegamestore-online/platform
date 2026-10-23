import { describe, expect, it } from 'vitest';
import * as root from '../index.js';
import * as feel from './index.js';

const FEEL_EXPORTS = [
  'createBurst',
  'stepParticles',
  'particleAlpha',
  'useParticles',
  'tweenValue',
  'tweenProgress',
  'easeOutQuad',
  'shakeKeyframes',
  'useShake',
  'vibrate',
  'HAPTICS',
  'useHaptics',
  'ScorePopup',
  'SCORE_POP_MS',
  'prefersReducedMotion',
];

describe('feel kit exports', () => {
  it.each(FEEL_EXPORTS)('%s is exported from the feel entry point', (name) => {
    expect(feel).toHaveProperty(name);
  });

  it.each(FEEL_EXPORTS)('%s is also exported from the package root', (name) => {
    expect(root).toHaveProperty(name);
  });

  it('keeps the existing root exports', () => {
    expect(root).toHaveProperty('GameShell');
    expect(root).toHaveProperty('GameResultScreen');
    expect(root).toHaveProperty('StartScreen');
  });
});
