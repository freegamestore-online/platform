import type * as React from 'react';
import type { ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';
import { Confetti } from './Confetti.js';
import { GameButton } from './GameButton.js';

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

/**
 * An animated result screen for a finished level or game. It is a modal dialog
 * with a title, optional stats and badge, optional extra content, and one
 * action. A win adds falling confetti. The action is focused when the screen
 * opens, so keyboard and screen-reader users land on the next step.
 *
 * It covers the viewport. The card sits on an opaque `bg-panel` surface; only
 * the scrim behind it is translucent. Motion is the `animate-fgs-*` utilities
 * from the SDK's `theme.css`, and it stops under prefers-reduced-motion.
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
  const actionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    actionsRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, []);

  return (
    <div
      data-fgs="result"
      data-tone={tone}
      className="fixed inset-0 z-[800] flex animate-fgs-fade items-center justify-center overflow-hidden bg-paper/70 p-4 backdrop-blur-[5px] motion-reduce:animate-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      {tone === 'win' && <Confetti />}
      <div className="relative z-[1] flex w-[min(20rem,100%)] animate-fgs-enter flex-col items-center gap-2 rounded-fgs border border-line bg-panel px-[1.1rem] pb-[1.1rem] pt-5 text-center shadow-[inset_0_1px_0_rgb(255_255_255/0.4),0_1px_2px_rgb(0_0_0/0.06),0_22px_40px_-20px_rgb(0_0_0/0.45)] motion-reduce:animate-none">
        {eyebrow && (
          <p className="m-0 text-[0.72rem] font-bold uppercase tracking-[0.12em] text-muted">
            {eyebrow}
          </p>
        )}
        <h2
          id={titleId}
          className={`m-0 animate-fgs-enter-title text-balance font-display text-fgs-title font-extrabold leading-none tracking-[-0.02em] [font-optical-sizing:auto] [font-variation-settings:'opsz'_144] motion-reduce:animate-none ${
            tone === 'win' ? 'text-accent-ink' : 'text-ink'
          }`}
        >
          {title}
        </h2>
        {message && <p className="m-0 text-[0.9rem] text-muted">{message}</p>}
        {stats.length > 0 && (
          <dl className="m-0 mt-2 grid w-full grid-cols-2 gap-2">
            {stats.map((stat, i) => (
              <div
                key={stat.label}
                className="animate-fgs-enter-stat rounded-xl border border-line bg-paper px-[0.4rem] py-2 shadow-[inset_0_-2px_0_rgb(0_0_0/0.04)] motion-reduce:animate-none last:odd:col-span-full"
                // Dynamic: the entrance delay is staggered by the stat's index.
                style={{ '--i': i } as React.CSSProperties}
              >
                <dt className="text-[0.68rem] font-bold uppercase tracking-[0.08em] text-muted">
                  {stat.label}
                </dt>
                <dd className="m-0 mt-[0.15rem] font-display text-fgs-stat font-extrabold tabular-nums text-ink">
                  {stat.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {badge ? (
          <div className="m-0 mt-1 animate-fgs-enter-badge text-[0.85rem] font-bold text-accent-ink motion-reduce:animate-none">
            {badge}
          </div>
        ) : null}
        {children}
        <div
          ref={actionsRef}
          className="mt-2 w-full animate-fgs-enter-actions motion-reduce:animate-none"
        >
          <GameButton variant="primary" size="lg" block onClick={action.onClick}>
            {action.label}
          </GameButton>
        </div>
      </div>
    </div>
  );
}
