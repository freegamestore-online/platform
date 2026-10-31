import type * as React from 'react';
import { LIGHT_COLOURS } from './tokens.js';

/** Number of falling pieces. */
const PIECES = 30;

/** A CSS variable with a fallback taken from the #209 light tokens. */
const v = (name: string, fallback: string) => `var(--${name}, ${fallback})`;

/** The default palette: the four status-and-accent colours, following the theme. */
export const CONFETTI_COLOURS: readonly string[] = [
  v('accent', LIGHT_COLOURS.accent),
  v('success', LIGHT_COLOURS.success),
  v('warning', LIGHT_COLOURS.warning),
  v('danger', LIGHT_COLOURS.error),
];

/** True when the player has asked for less motion. False on the server, where there is no window. */
function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

export interface ConfettiProps {
  /** Colours cycled across the pieces. Default: the accent and the status colours. */
  colours?: readonly string[];
}

/**
 * Falling confetti for a win. Each piece's position, drift, spin and timing
 * come from its index, so the render is the same every time. Renders nothing
 * under prefers-reduced-motion.
 *
 * The falling motion is the `animate-fgs-confetti` utility from the SDK's
 * `theme.css`. Only the per-piece values below are inline, because they are
 * computed from the piece's index.
 */
export function Confetti({ colours = CONFETTI_COLOURS }: ConfettiProps): React.JSX.Element | null {
  if (prefersReducedMotion()) return null;
  return (
    <div
      data-fgs="confetti"
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden motion-reduce:hidden"
      aria-hidden="true"
    >
      {Array.from({ length: PIECES }, (_, i) => (
        <span
          key={i}
          data-fgs="confetti-piece"
          className="absolute -top-3 left-(--x) h-[0.8rem] w-2 animate-fgs-confetti rounded-[2px] bg-(--colour) nth-[3n]:size-[0.6rem] nth-[3n]:rounded-full"
          // Dynamic: position, drift, spin, timing and colour all come from the piece index.
          style={
            {
              '--x': `${(i * 37) % 100}%`,
              '--drift': `${((i * 53) % 41) - 20}px`,
              '--spin': `${((i * 97) % 720) - 360}deg`,
              '--delay': `${(i % 7) * 70}ms`,
              '--duration': `${1500 + (i % 5) * 200}ms`,
              '--colour': colours[i % colours.length],
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
