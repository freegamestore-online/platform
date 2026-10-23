import type * as React from 'react';
import { useEffect, useRef } from 'react';
import { easeInQuad, easeOutQuad } from './easing.js';
import { prefersReducedMotion } from './reducedMotion.js';
import { tweenProgress, tweenValue } from './tween.js';

/** How long a pop-up stays on screen, in ms. */
export const SCORE_POP_MS = 700;

/** How far a pop-up rises before it fades, in px. */
const RISE_PX = 40;

/**
 * Styles for the pop-up. Its colour is the accent-ink token, so it follows the
 * theme, with a light-theme fallback. The motion itself is set from script.
 */
export const SCORE_POP_CSS = `
.fgs-score-pop {
  position: absolute;
  z-index: 750;
  pointer-events: none;
  white-space: nowrap;
  font-family: var(--font-display, "Fraunces", Georgia, serif);
  font-size: var(--text-stat, 1.25rem);
  font-weight: 800;
  color: var(--accent-ink, #2563eb);
  text-shadow: 0 1px 2px rgb(0 0 0 / 0.55);
  will-change: transform, opacity;
}
`;

export interface ScorePopupProps {
  /** The points to show, as `+N`. */
  points: number;
  /** Horizontal centre, in the pixel space of its positioned ancestor. */
  x: number;
  /** Vertical centre, in the pixel space of its positioned ancestor. */
  y: number;
  /** Called once the pop-up has finished. The parent should remove it. */
  onDone: () => void;
}

/**
 * A floating `+N` that rises and fades from (x, y), then calls `onDone`.
 * Under reduced motion it holds still for the same time, so the number is still
 * seen and `onDone` still fires. Place it inside a `position: relative` container.
 */
export function ScorePopup({ points, x, y, onDone }: ScorePopupProps): React.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  const onDoneRef = useRef(onDone);

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    if (prefersReducedMotion()) {
      const id = setTimeout(() => onDoneRef.current(), SCORE_POP_MS);
      return () => clearTimeout(id);
    }

    let started: number | null = null;
    let frame = 0;
    const step = (now: number) => {
      started ??= now;
      const elapsed = now - started;
      const rise = tweenValue(0, -RISE_PX, elapsed, SCORE_POP_MS, easeOutQuad);
      element.style.transform = `translate(-50%, calc(-50% + ${rise}px))`;
      element.style.opacity = String(tweenValue(1, 0, elapsed, SCORE_POP_MS, easeInQuad));
      if (tweenProgress(elapsed, SCORE_POP_MS) < 1) {
        frame = requestAnimationFrame(step);
      } else {
        onDoneRef.current();
      }
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <>
      <style>{SCORE_POP_CSS}</style>
      <span
        ref={ref}
        className="fgs-score-pop"
        style={{ left: x, top: y, transform: 'translate(-50%, -50%)' }}
      >
        {`+${points}`}
      </span>
    </>
  );
}
