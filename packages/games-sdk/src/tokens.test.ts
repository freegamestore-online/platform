import { describe, expect, it } from 'vitest';
import * as sdk from './index.js';
import {
  DARK_COLOUR_OVERRIDES,
  DARK_COLOURS,
  GAME_TOKENS_CSS,
  LIGHT_COLOURS,
  MOTION_TOKENS,
  REDUCED_MOTION_DURATIONS,
  SHAPE_TOKENS,
  TYPOGRAPHY_TOKENS,
} from './tokens.js';

const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** The text of the first top-level block that starts with `selector {`, up to its closing brace. */
function block(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no block for ${selector}`);
  return css.slice(start, css.indexOf('\n}', start) + 2);
}

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const root = block(GAME_TOKENS_CSS, ':root');
const dark = block(GAME_TOKENS_CSS, ':root[data-theme="dark"]');
const reduced = GAME_TOKENS_CSS.slice(GAME_TOKENS_CSS.indexOf('@media (prefers-reduced-motion: reduce)'));

describe('colour tokens', () => {
  it.each(Object.entries(LIGHT_COLOURS))('%s is declared on :root with its light value', (name, value) => {
    expect(root).toContain(`  --${kebab(name)}: ${value};`);
  });

  it.each(Object.entries(DARK_COLOUR_OVERRIDES))('%s is overridden under data-theme="dark"', (name, value) => {
    expect(dark).toContain(`  --${kebab(name)}: ${value};`);
  });

  it('keeps accent the same in both themes, so it is not in the dark block', () => {
    expect(dark).not.toContain('--accent:');
    expect(DARK_COLOURS.accent).toBe(LIGHT_COLOURS.accent);
  });

  it('resolves every dark colour to a value', () => {
    for (const [name, value] of Object.entries(DARK_COLOURS)) {
      expect(value, name).toMatch(/\S/);
    }
  });

  it('matches the Mosaic Rush pilot values', () => {
    expect(LIGHT_COLOURS.accent).toBe('#2563eb');
    expect(LIGHT_COLOURS.paper).toBe('#ffffff');
    expect(DARK_COLOURS.paper).toBe('#0f0f0f');
    expect(DARK_COLOURS.accentInk).toBe('#60a5fa');
    expect(DARK_COLOURS.accentSoft).toBe('#1a2e26');
  });

  it.each([
    ['light', LIGHT_COLOURS],
    ['dark', DARK_COLOURS],
  ])('the %s theme keeps ink and muted text at WCAG AA on the paper colour', (_theme, colours) => {
    expect(contrast(colours.ink, colours.paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colours.muted, colours.paper)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ['light', LIGHT_COLOURS],
    ['dark', DARK_COLOURS],
  ])('the %s theme keeps accent text at WCAG AA on the paper colour', (_theme, colours) => {
    expect(contrast(colours.accentInk, colours.paper)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('typography and shape tokens', () => {
  it.each(Object.entries(TYPOGRAPHY_TOKENS))('%s is declared on :root', (name, value) => {
    expect(root).toContain(`  --${kebab(name)}: ${value};`);
  });

  it('uses Fraunces for display and Manrope for body', () => {
    expect(TYPOGRAPHY_TOKENS.fontDisplay).toContain('Fraunces');
    expect(TYPOGRAPHY_TOKENS.fontBody).toContain('Manrope');
  });

  it('declares the radius on :root', () => {
    expect(root).toContain(`  --radius: ${SHAPE_TOKENS.radius};`);
  });
});

describe('motion tokens', () => {
  it.each(Object.entries(MOTION_TOKENS))('%s is declared on :root as --motion-*', (name, value) => {
    expect(root).toContain(`  --motion-${kebab(name)}: ${value};`);
  });

  it('gives every duration as milliseconds', () => {
    for (const duration of [MOTION_TOKENS.fast, MOTION_TOKENS.base, MOTION_TOKENS.slow]) {
      expect(duration).toMatch(/^\d+ms$/);
    }
  });

  it('gives every easing as a four-value cubic-bezier', () => {
    for (const easing of [MOTION_TOKENS.easeOut, MOTION_TOKENS.easeSpring]) {
      expect(easing).toMatch(/^cubic-bezier\((-?[\d.]+, ){3}-?[\d.]+\)$/);
    }
  });

  it('zeroes every duration under prefers-reduced-motion', () => {
    expect(reduced).toContain('@media (prefers-reduced-motion: reduce)');
    for (const name of Object.keys(REDUCED_MOTION_DURATIONS)) {
      expect(reduced, name).toContain(`--motion-${kebab(name)}: 0ms;`);
    }
  });

  it('leaves the easings alone under prefers-reduced-motion', () => {
    expect(reduced).not.toContain('ease');
  });
});

describe('GAME_TOKENS_CSS', () => {
  it('has the three blocks in order: light root, dark theme, reduced motion', () => {
    const rootAt = GAME_TOKENS_CSS.indexOf(':root {');
    const darkAt = GAME_TOKENS_CSS.indexOf(':root[data-theme="dark"]');
    const reducedAt = GAME_TOKENS_CSS.indexOf('@media (prefers-reduced-motion: reduce)');
    expect(rootAt).toBeGreaterThanOrEqual(0);
    expect(darkAt).toBeGreaterThan(rootAt);
    expect(reducedAt).toBeGreaterThan(darkAt);
  });

  it('declares each token name exactly once in the light root', () => {
    const declared = [...root.matchAll(/^\s+(--[\w-]+):/gm)].map((m) => m[1]);
    expect(new Set(declared).size).toBe(declared.length);
  });
});

describe('backward compatibility', () => {
  it('keeps the existing SDK exports', () => {
    for (const name of [
      'GameShell',
      'GameTopbar',
      'GameButton',
      'GameModal',
      'GameOverScreen',
      'GameConfirm',
      'GameThemeToggle',
      'GameTextSizeToggle',
      'GameAuth',
      'useAuth',
      'useGameSounds',
      'useSound',
    ]) {
      expect(sdk, name).toHaveProperty(name);
    }
  });

  it('exports the tokens from the package root', () => {
    for (const name of [
      'LIGHT_COLOURS',
      'DARK_COLOURS',
      'DARK_COLOUR_OVERRIDES',
      'TYPOGRAPHY_TOKENS',
      'SHAPE_TOKENS',
      'MOTION_TOKENS',
      'REDUCED_MOTION_DURATIONS',
      'GAME_TOKENS_CSS',
    ]) {
      expect(sdk, name).toHaveProperty(name);
    }
  });
});
