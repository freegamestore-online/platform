/**
 * Brand, typography and motion design tokens for FreeGameStore games.
 *
 * These values are lifted from the Mosaic Rush pilot (`web/src/index.css`),
 * which is the first game to be built on them. They are the single definition
 * the SDK documents. See TOKENS.md for the full reference.
 *
 * The SDK components read these as CSS custom properties (`var(--paper)` and
 * so on), with their own fallbacks. This module does not inject anything on
 * import (the package is `sideEffects: false`). A game that wants the tokens
 * adds GAME_TOKENS_CSS to its stylesheet, or copies it into index.css.
 *
 * Changing a value here changes every game that adopts the tokens, so treat
 * it as a platform-wide decision.
 */

/** Colour tokens. Each key becomes `--<kebab-case>`, for example `lineStrong` becomes `--line-strong`. */
export interface ColourTokens {
  /** Page and board background. */
  paper: string;
  /** Primary text. */
  ink: string;
  /** Secondary text and captions. */
  muted: string;
  /** Hairline borders on empty surfaces. */
  line: string;
  /** Borders on buttons and toggles. */
  lineStrong: string;
  /** Raised cards and overlays. */
  panel: string;
  /** Translucent surface, for frosted overlays. */
  glass: string;
  /** Bottom dock surface. */
  dock: string;
  /** Status: success. */
  success: string;
  /** Status: warning. */
  warning: string;
  /** Status: error. */
  error: string;
  /** Primary actions and highlights. */
  accent: string;
  /** Quiet fill behind accent text, for badges and tints. */
  accentSoft: string;
  /** Accent used as text (titles, badges). Lighter in dark mode so it passes AA on dark surfaces. */
  accentInk: string;
}

/** Light theme. The default when `data-theme` is absent. */
export const LIGHT_COLOURS: ColourTokens = {
  paper: '#ffffff',
  ink: '#1a1a1a',
  muted: '#6b7280',
  line: '#e5e7eb',
  lineStrong: '#d1d5db',
  panel: '#f9fafb',
  glass: 'rgba(255, 255, 255, 0.8)',
  dock: '#ffffff',
  success: '#16a34a',
  warning: '#d97706',
  error: '#dc2626',
  accent: '#2563eb',
  accentSoft: '#eff6ff',
  accentInk: '#2563eb',
};

/**
 * Only the tokens that differ in dark mode. Applied under `:root[data-theme="dark"]`.
 * `accent` is not listed: it is the same in both themes.
 */
export const DARK_COLOUR_OVERRIDES: Partial<ColourTokens> = {
  paper: '#0f0f0f',
  ink: '#f5f5f5',
  muted: '#9ca3af',
  line: '#2d2d2d',
  lineStrong: '#404040',
  panel: '#1a1a1a',
  glass: 'rgba(15, 15, 15, 0.8)',
  dock: '#1a1a1a',
  success: '#22c55e',
  warning: '#fbbf24',
  error: '#ef4444',
  accentSoft: '#1a2e26',
  accentInk: '#60a5fa',
};

/** Dark theme, resolved: the light values with the dark overrides applied. */
export const DARK_COLOURS: ColourTokens = { ...LIGHT_COLOURS, ...DARK_COLOUR_OVERRIDES };

/** Typography tokens. Only display headings and score values use the display face. */
export interface TypographyTokens {
  /** Display face for titles and score values. */
  fontDisplay: string;
  /** Body face for everything else. */
  fontBody: string;
  /** Score and stat values. */
  textStat: string;
  /** Overlay titles. */
  textTitle: string;
  /** The start-screen title. */
  textDisplay: string;
}

export const TYPOGRAPHY_TOKENS: TypographyTokens = {
  fontDisplay: '"Fraunces", Georgia, serif',
  fontBody: '"Manrope", system-ui, sans-serif',
  textStat: '1.25rem',
  textTitle: 'clamp(2rem, 9vw, 2.6rem)',
  textDisplay: 'clamp(2.25rem, 11vw, 3.25rem)',
};

/** Shape tokens. */
export interface ShapeTokens {
  /** Corner radius for cards and overlays. */
  radius: string;
}

export const SHAPE_TOKENS: ShapeTokens = {
  radius: '1.25rem',
};

/** Motion tokens. Durations and easings every animation reads. */
export interface MotionTokens {
  /** Quick feedback, such as a press or a pop. */
  fast: string;
  /** Standard transitions. */
  base: string;
  /** Larger entrances and overlays. */
  slow: string;
  /** Default ease-out curve. */
  easeOut: string;
  /** Overshooting spring curve for pops. */
  easeSpring: string;
  /**
   * The default duration for a control transition, such as a press or a hover.
   * It follows `fast`, and reduced motion sets it to 0ms.
   */
  duration: string;
  /** The default easing for a control transition. It follows `easeOut`. */
  easing: string;
}

export const MOTION_TOKENS: MotionTokens = {
  fast: '120ms',
  base: '240ms',
  slow: '420ms',
  easeOut: 'cubic-bezier(0.2, 0.9, 0.3, 1)',
  easeSpring: 'cubic-bezier(0.2, 0.9, 0.3, 1.3)',
  duration: 'var(--motion-fast)',
  easing: 'var(--motion-ease-out)',
};

/**
 * Durations under `prefers-reduced-motion: reduce`. The animations finish at
 * once and only the final state is shown. Easings are unchanged.
 */
export const REDUCED_MOTION_DURATIONS: Pick<MotionTokens, 'fast' | 'base' | 'slow' | 'duration'> = {
  fast: '0ms',
  base: '0ms',
  slow: '0ms',
  duration: '0ms',
};

const toKebab = (name: string): string => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

const declarations = (entries: object, prefix = '', indent = '  '): string =>
  Object.entries(entries)
    .map(([key, value]) => `${indent}--${prefix}${toKebab(key)}: ${value};`)
    .join('\n');

/**
 * A stylesheet that defines every token. It has three blocks:
 *   - `:root`, the light values and the type, shape and motion tokens;
 *   - `:root[data-theme="dark"]`, the dark colour overrides;
 *   - `prefers-reduced-motion: reduce`, which zeroes the durations.
 *
 * Add it to a game's stylesheet, for example `<style>{GAME_TOKENS_CSS}</style>`
 * or the top of `index.css`.
 */
export const GAME_TOKENS_CSS = [
  `:root {\n${[
    declarations(LIGHT_COLOURS),
    declarations(TYPOGRAPHY_TOKENS),
    declarations(SHAPE_TOKENS),
    declarations(MOTION_TOKENS, 'motion-'),
  ].join('\n')}\n}`,
  `:root[data-theme="dark"] {\n${declarations(DARK_COLOUR_OVERRIDES)}\n}`,
  `@media (prefers-reduced-motion: reduce) {\n  :root {\n${declarations(REDUCED_MOTION_DURATIONS, 'motion-', '    ')}\n  }\n}`,
].join('\n\n');
