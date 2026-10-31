import type * as React from 'react';
import { useEffect, useRef } from 'react';
import { easeInQuad, easeOutQuad } from './easing.js';
import { prefersReducedMotion } from './reducedMotion.js';
import { tweenProgress, tweenValue } from './tween.js';

/** How long a pop-up stays on screen, in ms. */
export const SCORE_POP_MS = 700;

/** How far a pop-up rises before it fades, in px. */
const RISE_PX = 40;

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
    <span
      ref={ref}
      data-fgs="score-popup"
      className="pointer-events-none absolute z-[750] whitespace-nowrap font-display text-fgs-stat font-extrabold text-accent-ink will-change-[transform,opacity] [text-shadow:0_1px_2px_rgb(0_0_0/0.55)] [transform:translate(-50%,-50%)]"
      // Dynamic: the pop-up is placed at the caller's x and y; the rise and fade are set from script.
      style={{ left: x, top: y }}
    >
      {`+${points}`}
    </span>
  );
}
