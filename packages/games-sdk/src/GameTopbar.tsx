import type * as React from 'react';
import type { ReactNode } from 'react';
import { forwardRef, useEffect, useRef, useState } from 'react';
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
   * Optional extra content for the About panel (credits, a one-line pitch,
   * links). The About (i) button is ALWAYS shown regardless — it also displays
   * the game's deployed version + timestamp, read from `/version.json`. Pass
   * this only to add your own content above that.
   */
  about?: ReactNode;

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
 * Shared icon button style for topbar controls. All buttons in the topbar
 * (catalog, rules, play/pause, restart, about, sound, close) use this
 * consistent sizing and behavior.
 */
interface TopbarIconButtonProps {
  onClick?: () => void;
  href?: string;
  target?: string;
  rel?: string;
  color?: string;
  ariaLabel: string;
  ariaPressed?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
  children: ReactNode;
}

const TopbarIconButton = forwardRef<HTMLButtonElement, Omit<TopbarIconButtonProps, 'ref'>>(
  function TopbarIconButton(
    {
      onClick,
      href,
      target,
      rel,
      color = 'var(--muted, #999)',
      ariaLabel,
      ariaPressed,
      children,
    },
    ref,
  ) {
    const baseStyle = {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      padding: 0,
      minWidth: '2.75rem',
      minHeight: '2.75rem',
      display: 'flex' as const,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      color,
      WebkitTapHighlightColor: 'transparent',
    };

    const linkStyle = {
      ...baseStyle,
      textDecoration: 'none' as const,
    };

    if (href) {
      return (
        <a
          data-fgs-tb-btn
          href={href}
          target={target}
          rel={rel}
          style={linkStyle}
          aria-label={ariaLabel}
        >
          {children}
        </a>
      );
    }

    return (
      <button
        ref={ref}
        data-fgs-tb-btn
        onClick={onClick}
        style={baseStyle}
        aria-label={ariaLabel}
        aria-pressed={ariaPressed}
      >
        {children}
      </button>
    );
  }
);

/**
 * The single allowed topbar shape for FreeGameStore games. Brand
 * consistency: same font, same paddings, same color tokens, same stat
 * layout across every game on the storefront.
 *
 * Use inside <GameShell topbar={<GameTopbar … />}>.
 */
export function GameTopbar({
  title,
  score,
  stats,
  actions,
  rules,
  about,
  onPlayPause,
  paused,
  onRestart,
}: GameTopbarProps): React.JSX.Element {
  const [showRules, setShowRules] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const sound = useSound();

  const resolvedStats: GameTopbarStat[] =
    stats && stats.length > 0
      ? stats
      : score !== undefined
        ? [{ label: 'Score', value: score, accent: true }]
        : [];

  return (
    <>
      {/* One stylesheet for every interactive control in the topbar.
          Inline styles give us the runtime values (color tokens,
          dimensions) but can't express :active / :focus-visible, so
          those pseudo-states live here. The `data-fgs-tb-btn`
          attribute on every button + link selects them all uniformly.
          The block renders once per topbar instance — browsers de-dupe
          identical content and games only mount a single topbar. */}
      <style>{TOPBAR_BUTTON_CSS}</style>
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
          {/* Catalog — back to store listing.
              2×2 grid icon, not a house. A house icon clashed with the
              browser's own "home" button on Android Chrome (two visually
              identical home icons one above the other was confusing —
              users couldn't tell which one belonged to the page). A
              grid reads as "all games / browse the catalog" and is
              visually distinct from anything browser chrome ships. */}
          <TopbarIconButton
            href="https://freegamestore.online"
            target="_blank"
            rel="noopener noreferrer"
            ariaLabel="Browse all games"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="2" y="2" width="5" height="5" rx="1" />
              <rect x="9" y="2" width="5" height="5" rx="1" />
              <rect x="2" y="9" width="5" height="5" rx="1" />
              <rect x="9" y="9" width="5" height="5" rx="1" />
            </svg>
          </TopbarIconButton>
          {rules !== undefined && (
            <TopbarIconButton
              onClick={() => setShowRules(true)}
              ariaLabel="Game rules"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="8" cy="8" r="6.5" />
                <path d="M8 11.5v0M8 5v4" />
              </svg>
            </TopbarIconButton>
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
            <TopbarIconButton
              onClick={onPlayPause}
              color="var(--ink, #f0f0f0)"
              ariaLabel="Pause"
              ariaPressed={paused === true}
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
            </TopbarIconButton>
          )}
          {onRestart !== undefined && (
            <TopbarIconButton
              onClick={onRestart}
              ariaLabel="Restart"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M2 8a6 6 0 0111.5-2.5" />
                <path d="M14 8a6 6 0 01-11.5 2.5" />
                <path d="M14 2v3.5h-3.5" />
                <path d="M2 14v-3.5h3.5" />
              </svg>
            </TopbarIconButton>
          )}
          {/* About — always present. Opens version + timestamp + credits. */}
          <TopbarIconButton
            onClick={() => setShowAbout(true)}
            ariaLabel="About this game"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="8" cy="8" r="6.5" />
              <path d="M8 7.25v3.5" />
              <path d="M8 5.15v0" />
            </svg>
          </TopbarIconButton>
          {/* Sound toggle — always present, muted by default */}
          <TopbarIconButton
            onClick={sound.toggle}
            color={sound.muted ? 'var(--muted, #999)' : 'var(--accent, #10b981)'}
            ariaLabel="Mute"
            ariaPressed={sound.muted}
          >
            {sound.muted ? (
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M8 2L4 5.5H1.5v5H4L8 14V2z" />
                <path d="M12 5.5l4 5M16 5.5l-4 5" />
              </svg>
            ) : (
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M8 2L4 5.5H1.5v5H4L8 14V2z" />
                <path d="M11.5 5a4.5 4.5 0 010 6" />
                <path d="M13.5 3a7.5 7.5 0 010 10" />
              </svg>
            )}
          </TopbarIconButton>
          {actions !== undefined && (
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>{actions}</div>
          )}
        </div>
      </div>

      {showRules && rules !== undefined && (
        <RulesOverlay onClose={() => setShowRules(false)}>{rules}</RulesOverlay>
      )}

      {showAbout && (
        <AboutOverlay title={title} extra={about} onClose={() => setShowAbout(false)} />
      )}
    </>
  );
}

interface VersionInfo {
  version?: string;
  deployedAt?: string;
  source?: string;
}

/** Compact "3 hours ago" style relative time — no dependency, no locale data. */
function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  const units: [number, string][] = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [30, 'day'],
    [12, 'month'],
    [Number.POSITIVE_INFINITY, 'year'],
  ];
  let n = secs;
  let unit = 'second';
  for (const [div, name] of units) {
    if (n < div) {
      unit = name;
      break;
    }
    n = Math.floor(n / div);
    unit = name;
  }
  if (secs < 45) return 'just now';
  return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
}

/**
 * The About panel: the game's deployed version + when it shipped (read from
 * `/version.json`, which every FreeGameStore game serves), plus any custom
 * `extra` content and the store link. Version fetch is lazy — only when opened —
 * and fails silently (a local `pnpm dev` build has no version.json).
 */
function AboutOverlay({
  title,
  extra,
  onClose,
}: {
  title?: string | undefined;
  extra?: ReactNode | undefined;
  onClose: () => void;
}): React.JSX.Element {
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/version.json', { cache: 'no-cache' })
      .then((r) =>
        r.ok ? (r.json() as Promise<VersionInfo>) : Promise.reject(new Error(String(r.status))),
      )
      .then((d) => {
        if (!cancelled) setInfo(d);
      })
      .catch(() => {
        /* dev build / unreachable — show "development build" below */
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const version = (info?.version ?? '').slice(0, 7);
  const deployedAt = info?.deployedAt;

  return (
    <RulesOverlay title="About" onClose={onClose}>
      {title !== undefined && (
        <h1
          style={{
            fontFamily: '"Fraunces", Georgia, serif',
            fontWeight: 700,
            fontSize: '1.5rem',
            margin: '0 0 0.75rem',
          }}
        >
          {title}
        </h1>
      )}

      {extra !== undefined && <div style={{ marginBottom: '1rem' }}>{extra}</div>}

      <dl
        style={{
          margin: 0,
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          gap: '0.35rem 1rem',
          fontSize: '0.85rem',
        }}
      >
        <dt style={{ color: 'var(--muted, #999)' }}>Version</dt>
        <dd style={{ margin: 0, fontVariantNumeric: 'tabular-nums' }}>
          {version ? (
            <code style={{ fontFamily: 'monospace' }}>{version}</code>
          ) : loaded ? (
            'development build'
          ) : (
            '…'
          )}
        </dd>
        {deployedAt && (
          <>
            <dt style={{ color: 'var(--muted, #999)' }}>Deployed</dt>
            <dd style={{ margin: 0 }} title={new Date(deployedAt).toLocaleString()}>
              {relativeTime(deployedAt)}
            </dd>
          </>
        )}
      </dl>

      <p style={{ marginTop: '1.25rem', fontSize: '0.8rem', color: 'var(--muted, #999)' }}>
        A free game on{' '}
        <a
          href="https://freegamestore.online"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--accent, #10b981)', textDecoration: 'none' }}
        >
          FreeGameStore
        </a>
        .
      </p>
    </RulesOverlay>
  );
}

function RulesOverlay({
  children,
  title = 'How to Play',
  onClose,
}: {
  children: ReactNode;
  title?: string;
  onClose: () => void;
}): React.JSX.Element {
  const overlayRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Focus the close button when the overlay opens for keyboard accessibility
    closeButtonRef.current?.focus();

    // Handle Escape key to close the overlay, and prevent other keys from
    // reaching game key handlers (which would continue game input while playing)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else {
        // Prevent any other key events from reaching the game
        e.preventDefault();
        e.stopPropagation();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [onClose]);

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label={title}
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
          {title}
        </span>
        <TopbarIconButton
          ref={closeButtonRef}
          onClick={onClose}
          ariaLabel="Close"
        >
          &times;
        </TopbarIconButton>
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
          // Was 0.5rem (~8px) — too small to read in sunlight or for
          // anyone with even mild low vision. 0.65rem (~10.4px) keeps
          // the visual hierarchy (value still dominates at 0.85rem)
          // while staying legible.
          fontSize: '0.65rem',
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

/**
 * Pseudo-state styling for every topbar button + link. Tagged via
 * `data-fgs-tb-btn`. Keep this small and predictable — the topbar is
 * brand surface, not a creative palette.
 *
 *   :active — opacity dip so taps feel anchored on touch devices that
 *             otherwise give no feedback (we already disable the
 *             default tap-highlight via WebkitTapHighlightColor).
 *
 *   :focus-visible — accent outline so keyboard users see where focus
 *                    is. -2px outline-offset draws inside the button's
 *                    2.75rem touch target so the ring doesn't bleed
 *                    into adjacent controls.
 */
const TOPBAR_BUTTON_CSS = `
[data-fgs-tb-btn] { transition: opacity 80ms ease; }
[data-fgs-tb-btn]:active { opacity: 0.55; }
[data-fgs-tb-btn]:focus-visible {
  outline: 2px solid var(--accent, #10b981);
  outline-offset: -2px;
  border-radius: 0.4rem;
}
`;
