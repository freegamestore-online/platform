import type * as React from 'react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useSound } from './SoundContext.js';

export interface GameTopbarStat {
  /** Short uppercase label, e.g. "Score", "Lives", "Level". */
  label: string;
  /** Display value — string or number. Shown big. */
  value: ReactNode;
  /**
   * Optional accent — flips the value's color to the platform accent
   * (typically used for the primary score).
   */
  accent?: boolean;
}

export interface GameTopbarProps {
  /** The game's display name. Shows on the left in Manrope. */
  title?: string;

  /**
   * Convenience: the most-common case. If present, renders as a single
   * "Score" stat. Equivalent to passing `stats: [{ label: 'Score',
   * value: score, accent: true }]`.
   */
  score?: number;

  /**
   * Custom stat lineup. Use for games that need more than just a score
   * (lives, level, time, etc.). Replaces the score-only convenience.
   */
  stats?: GameTopbarStat[];

  /**
   * Optional right-side action slot for game-specific controls.
   * Keep to ≤2 buttons — the topbar is brand surface, not a settings menu.
   */
  actions?: ReactNode;

  /**
   * Game rules/instructions. When provided, an ℹ info icon appears in the
   * topbar. Tapping it opens a fullscreen overlay with the rules content.
   */
  rules?: ReactNode;

  /**
   * For interactive/real-time games (Tetris, Snake, etc.). When provided,
   * the SDK renders standard play/pause + restart icon buttons in the topbar.
   * `paused` controls the icon state (play vs pause).
   */
  onPlayPause?: () => void;

  /**
   * Whether the game is currently paused. Controls the play/pause icon.
   * Only used when `onPlayPause` is provided.
   */
  paused?: boolean;

  /**
   * Restart/stop callback. When provided, renders a restart icon button.
   */
  onRestart?: () => void;
}

/**
 * The single allowed topbar shape for FreeGameStore games. Brand
 * consistency: same font, same paddings, same color tokens, same stat
 * layout across every game on the storefront.
 *
 * Use inside <GameShell topbar={<GameTopbar … />}>.
 */
export function GameTopbar({ title, score, stats, actions, rules, onPlayPause, paused, onRestart }: GameTopbarProps): React.JSX.Element {
  const [showRules, setShowRules] = useState(false);
  const sound = useSound();

  const resolvedStats: GameTopbarStat[] =
    stats && stats.length > 0
      ? stats
      : score !== undefined
        ? [{ label: 'Score', value: score, accent: true }]
        : [];

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.75rem',
          padding: '0.25rem 0.75rem',
          height: '2rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', minWidth: 0 }}>
          {/* Home — back to store listing */}
          <a
            href="https://freegamestore.online"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              minWidth: '2.75rem',
              minHeight: '2.75rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--muted, #999)',
              WebkitTapHighlightColor: 'transparent',
              textDecoration: 'none',
            }}
            aria-label="Browse all games"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 6l6-4 6 4v7a1 1 0 01-1 1H3a1 1 0 01-1-1V6z" />
              <path d="M6 14V9h4v5" />
            </svg>
          </a>
          {rules !== undefined && (
            <button
              onClick={() => setShowRules(true)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                minWidth: '2.75rem',
                minHeight: '2.75rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--muted, #999)',
                lineHeight: 1,
                WebkitTapHighlightColor: 'transparent',
              }}
              aria-label="Game rules"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="8" cy="8" r="6.5" />
                <path d="M8 11.5v0M8 5v4" />
              </svg>
            </button>
          )}
          {title !== undefined && (
            <span
              style={{
                fontFamily: '"Manrope", system-ui, sans-serif',
                fontWeight: 600,
                fontSize: '0.8rem',
                letterSpacing: '-0.01em',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {title}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {resolvedStats.map((s) => (
            <Stat key={s.label} stat={s} />
          ))}
          {/* Play/Pause + Restart — opt-in for interactive games */}
          {onPlayPause !== undefined && (
            <button
              onClick={onPlayPause}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                minWidth: '2.75rem',
                minHeight: '2.75rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--ink, #f0f0f0)',
                WebkitTapHighlightColor: 'transparent',
              }}
              aria-label={paused ? 'Play' : 'Pause'}
            >
              {paused ? (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M4 2l10 6-10 6V2z" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <rect x="2" y="2" width="4" height="12" rx="1" />
                  <rect x="10" y="2" width="4" height="12" rx="1" />
                </svg>
              )}
            </button>
          )}
          {onRestart !== undefined && (
            <button
              onClick={onRestart}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                minWidth: '2.75rem',
                minHeight: '2.75rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--muted, #999)',
                WebkitTapHighlightColor: 'transparent',
              }}
              aria-label="Restart"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 8a6 6 0 0111.5-2.5" />
                <path d="M14 8a6 6 0 01-11.5 2.5" />
                <path d="M14 2v3.5h-3.5" />
                <path d="M2 14v-3.5h3.5" />
              </svg>
            </button>
          )}
          {/* Sound toggle — always present, muted by default */}
          <button
            onClick={sound.toggle}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              minWidth: '2.75rem',
              minHeight: '2.75rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: sound.muted ? 'var(--muted, #999)' : 'var(--accent, #10b981)',
              WebkitTapHighlightColor: 'transparent',
            }}
            aria-label={sound.muted ? 'Unmute' : 'Mute'}
          >
            {sound.muted ? (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 2L4 5.5H1.5v5H4L8 14V2z" />
                <path d="M12 5.5l4 5M16 5.5l-4 5" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 2L4 5.5H1.5v5H4L8 14V2z" />
                <path d="M11.5 5a4.5 4.5 0 010 6" />
                <path d="M13.5 3a7.5 7.5 0 010 10" />
              </svg>
            )}
          </button>
          {actions !== undefined && (
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>{actions}</div>
          )}
        </div>
      </div>

      {showRules && rules !== undefined && (
        <RulesOverlay onClose={() => setShowRules(false)}>{rules}</RulesOverlay>
      )}
    </>
  );
}

function RulesOverlay({ children, onClose }: { children: ReactNode; onClose: () => void }): React.JSX.Element {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'var(--paper, #0f0f0f)',
        color: 'var(--ink, #f0f0f0)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.5rem 0.75rem',
          borderBottom: '1px solid var(--line, #2a2a2a)',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontFamily: '"Manrope", system-ui, sans-serif',
            fontWeight: 700,
            fontSize: '0.9rem',
          }}
        >
          How to Play
        </span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--muted, #999)',
            fontSize: '1.2rem',
            minWidth: '2.75rem',
            minHeight: '2.75rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            WebkitTapHighlightColor: 'transparent',
          }}
          aria-label="Close rules"
        >
          &times;
        </button>
      </div>
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '1rem',
          fontFamily: '"Manrope", system-ui, sans-serif',
          fontSize: '0.9rem',
          lineHeight: 1.6,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Stat({ stat }: { stat: GameTopbarStat }): React.JSX.Element {
  return (
    <div style={{ textAlign: 'right', lineHeight: 1.05 }}>
      <div
        style={{
          fontFamily: '"Manrope", system-ui, sans-serif',
          fontWeight: 800,
          fontSize: '0.85rem',
          color: stat.accent === true ? 'var(--accent)' : 'var(--ink)',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1,
        }}
      >
        {stat.value}
      </div>
      <div
        style={{
          fontSize: '0.5rem',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--muted)',
          lineHeight: 1,
        }}
      >
        {stat.label}
      </div>
    </div>
  );
}
