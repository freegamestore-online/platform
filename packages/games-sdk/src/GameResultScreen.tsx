import type * as React from 'react';
import type { ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';
import { Confetti } from './Confetti.js';
import { GameButton } from './GameButton.js';
import { LIGHT_COLOURS, MOTION_TOKENS, SHAPE_TOKENS, TYPOGRAPHY_TOKENS } from './tokens.js';

export interface GameResultStat {
  /** Short label, shown small and uppercase. */
  label: string;
  /** The value, shown large in the display face. */
  value: string | number;
}

export interface GameResultScreenProps {
  /** 'win' shows confetti and the accent title colour. 'lose' shows the card without confetti. */
  tone: 'win' | 'lose';
  /** Small line above the title, e.g. the level name. */
  eyebrow?: string;
  /** The headline, set large in the display face. */
  title: string;
  /** One line under the title. */
  message?: string;
  /** Stat rows shown in a two-column grid. Omit or pass [] for none. */
  stats?: readonly GameResultStat[];
  /** A highlight line under the stats, such as "New best!". */
  badge?: ReactNode;
  /** The primary action. It is focused when the screen opens. */
  action: { label: string; onClick: () => void };
  /** Extra content between the badge and the action, such as a leaderboard submit button. */
  children?: ReactNode;
}

/** A CSS variable with a fallback taken from the #209 light tokens, so the screen renders without GAME_TOKENS_CSS. */
const v = (name: string, fallback: string) => `var(--${name}, ${fallback})`;

/**
 * Styles for the result screen. Durations and easings come from the motion
 * tokens. Everything stops under prefers-reduced-motion. Class names carry the
 * `fgs-` prefix, so they cannot collide with a game's own styles.
 */
export const RESULT_SCREEN_CSS = `
.fgs-result-overlay {
  position: fixed;
  inset: 0;
  z-index: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  overflow: hidden;
  background: color-mix(in srgb, ${v('paper', LIGHT_COLOURS.paper)} 72%, transparent);
  backdrop-filter: blur(5px);
  animation: fgs-result-fade ${v('motion-base', MOTION_TOKENS.base)} ease-out both;
}
.fgs-result-card {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  width: min(20rem, 100%);
  padding: 1.25rem 1.1rem 1.1rem;
  border-radius: ${v('radius', SHAPE_TOKENS.radius)};
  text-align: center;
  background: ${v('panel', LIGHT_COLOURS.panel)};
  border: 1px solid ${v('line', LIGHT_COLOURS.line)};
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.4),
    0 1px 2px rgb(0 0 0 / 0.06),
    0 22px 40px -20px rgb(0 0 0 / 0.45);
  animation: fgs-result-enter ${v('motion-slow', MOTION_TOKENS.slow)} cubic-bezier(0.2, 0.9, 0.3, 1.15) both;
}
.fgs-result-eyebrow {
  margin: 0;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: ${v('muted', LIGHT_COLOURS.muted)};
}
.fgs-result-title {
  margin: 0;
  font-family: ${v('font-display', TYPOGRAPHY_TOKENS.fontDisplay)};
  font-weight: 800;
  font-optical-sizing: auto;
  font-variation-settings: "opsz" 144;
  font-size: ${v('text-title', TYPOGRAPHY_TOKENS.textTitle)};
  line-height: 1;
  letter-spacing: -0.02em;
  color: ${v('ink', LIGHT_COLOURS.ink)};
  text-wrap: balance;
  animation: fgs-result-enter ${v('motion-slow', MOTION_TOKENS.slow)} cubic-bezier(0.2, 0.9, 0.3, 1.2) 120ms both;
}
.fgs-result-win .fgs-result-title {
  color: ${v('accent-ink', LIGHT_COLOURS.accentInk)};
}
.fgs-result-message {
  margin: 0;
  font-size: 0.9rem;
  color: ${v('muted', LIGHT_COLOURS.muted)};
}
.fgs-result-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
  width: 100%;
  margin: 0.5rem 0 0;
}
.fgs-result-stat {
  padding: 0.5rem 0.4rem;
  border-radius: 0.75rem;
  background: ${v('paper', LIGHT_COLOURS.paper)};
  border: 1px solid ${v('line', LIGHT_COLOURS.line)};
  box-shadow: inset 0 -2px 0 rgb(0 0 0 / 0.04);
  animation: fgs-result-enter ${v('motion-base', MOTION_TOKENS.base)} ease-out both;
  animation-delay: calc(260ms + var(--i, 0) * 70ms);
}
.fgs-result-stat:last-child:nth-child(odd) {
  grid-column: 1 / -1;
}
.fgs-result-stat dt {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: ${v('muted', LIGHT_COLOURS.muted)};
}
.fgs-result-stat dd {
  margin: 0.15rem 0 0;
  font-family: ${v('font-display', TYPOGRAPHY_TOKENS.fontDisplay)};
  font-weight: 800;
  font-size: ${v('text-stat', TYPOGRAPHY_TOKENS.textStat)};
  color: ${v('ink', LIGHT_COLOURS.ink)};
  font-variant-numeric: tabular-nums;
}
.fgs-result-badge {
  margin: 0.25rem 0 0;
  font-size: 0.85rem;
  font-weight: 700;
  color: ${v('accent-ink', LIGHT_COLOURS.accentInk)};
  animation: fgs-result-enter ${v('motion-base', MOTION_TOKENS.base)} ease-out 560ms both;
}
.fgs-result-actions {
  width: 100%;
  margin-top: 0.5rem;
  animation: fgs-result-enter ${v('motion-base', MOTION_TOKENS.base)} ease-out 480ms both;
}
@keyframes fgs-result-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes fgs-result-enter {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .fgs-result-overlay,
  .fgs-result-card,
  .fgs-result-title,
  .fgs-result-stat,
  .fgs-result-badge,
  .fgs-result-actions {
    animation: none;
  }
}
`;

/**
 * An animated result screen for a finished level or game. It is a modal dialog
 * with a title, optional stats and badge, optional extra content, and one
 * action. A win adds falling confetti. The action is focused when the screen
 * opens, so keyboard and screen-reader users land on the next step.
 *
 * It covers the viewport. Motion is CSS only, and it stops under
 * prefers-reduced-motion.
 */
export function GameResultScreen({
  tone,
  eyebrow,
  title,
  message,
  stats = [],
  badge,
  action,
  children,
}: GameResultScreenProps) {
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    cardRef.current?.querySelector<HTMLButtonElement>('.fgs-result-actions button')?.focus();
  }, []);

  return (
    <div
      className={`fgs-result-overlay fgs-result-${tone}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <style>{RESULT_SCREEN_CSS}</style>
      {tone === 'win' && <Confetti />}
      <div className="fgs-result-card" ref={cardRef}>
        {eyebrow && <p className="fgs-result-eyebrow">{eyebrow}</p>}
        <h2 id={titleId} className="fgs-result-title">
          {title}
        </h2>
        {message && <p className="fgs-result-message">{message}</p>}
        {stats.length > 0 && (
          <dl className="fgs-result-stats">
            {stats.map((stat, i) => (
              <div
                key={stat.label}
                className="fgs-result-stat"
                style={{ '--i': i } as React.CSSProperties}
              >
                <dt>{stat.label}</dt>
                <dd>{stat.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {badge ? <div className="fgs-result-badge">{badge}</div> : null}
        {children}
        <div className="fgs-result-actions">
          <GameButton variant="primary" size="lg" block onClick={action.onClick}>
            {action.label}
          </GameButton>
        </div>
      </div>
    </div>
  );
}
