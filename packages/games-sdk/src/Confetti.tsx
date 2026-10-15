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
  v('error', LIGHT_COLOURS.error),
];

/**
 * Styles for the falling pieces. Each piece's duration and delay are set
 * inline. Under prefers-reduced-motion the layer is hidden, because the
 * falling pieces are decoration only.
 */
export const CONFETTI_CSS = `
.fgs-confetti {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
}
.fgs-confetti-piece {
  position: absolute;
  top: -12px;
  left: var(--x);
  width: 0.5rem;
  height: 0.8rem;
  border-radius: 2px;
  background: var(--colour);
  animation: fgs-confetti-fall var(--duration, 1.6s) cubic-bezier(0.3, 0, 0.7, 1) var(--delay, 0ms) both;
}
.fgs-confetti-piece:nth-child(3n) {
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 999px;
}
@keyframes fgs-confetti-fall {
  from { transform: translate3d(0, 0, 0) rotate(0deg); opacity: 1; }
  80% { opacity: 1; }
  to { transform: translate3d(var(--drift, 0px), 620px, 0) rotate(var(--spin, 360deg)); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .fgs-confetti {
    display: none;
  }
}
`;

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
 */
export function Confetti({ colours = CONFETTI_COLOURS }: ConfettiProps): React.JSX.Element | null {
  if (prefersReducedMotion()) return null;
  return (
    <div className="fgs-confetti" aria-hidden="true">
      <style>{CONFETTI_CSS}</style>
      {Array.from({ length: PIECES }, (_, i) => (
        <span
          key={i}
          className="fgs-confetti-piece"
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
