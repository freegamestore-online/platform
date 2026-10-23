import type * as React from 'react';
import type { ReactNode } from 'react';
import { forwardRef, useEffect, useRef, useState } from 'react';
import styles from './GameTopbar.module.css';
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
   * The live score shown in the score pill. Only rendered when `showScore` is
   * true. Without `showScore`, the pill stays hidden (#348).
   */
  score?: number;

  /**
   * Show the live score pill (#348). Off by default, so the topbar stays clean
   * for games that do not use it. Games that want the pill set this to true
   * and pass `score`.
   */
  showScore?: boolean;

  /**
   * Custom stat lineup, e.g. lives, level or time. Each entry renders as a
   * stat pill in the topbar.
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

/** The colour of an icon button. Maps to a class in GameTopbar.module.css. */
type IconTone = 'muted' | 'ink' | 'accent';

interface TopbarIconButtonProps {
  onClick?: () => void;
  href?: string;
  target?: string;
  rel?: string;
  tone?: IconTone;
  ariaLabel: string;
  ariaPressed?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
  children: ReactNode;
}

/**
 * Shared icon button for topbar controls. All buttons in the topbar (catalog,
 * rules, play/pause, restart, about, sound, close) use this consistent sizing
 * and behaviour. The `data-fgs-tb-btn` attribute is kept on every control so
 * games that already target it keep working.
 */
const TopbarIconButton = forwardRef<HTMLButtonElement, Omit<TopbarIconButtonProps, 'ref'>>(
  function TopbarIconButton(
    { onClick, href, target, rel, tone = 'muted', ariaLabel, ariaPressed, children },
    ref,
  ) {
    const className = `${styles.button} ${toneClass(tone)}`;

    if (href) {
      return (
        <a
          data-fgs-tb-btn
          href={href}
          target={target}
          rel={rel}
          className={`${className} ${styles.link}`}
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
        className={className}
        aria-label={ariaLabel}
        aria-pressed={ariaPressed}
      >
        {children}
      </button>
    );
  },
);

function toneClass(tone: IconTone): string {
  if (tone === 'ink') return styles.toneInk ?? '';
  if (tone === 'accent') return styles.toneAccent ?? '';
  return styles.toneMuted ?? '';
}

/**
 * The single allowed topbar shape for FreeGameStore games. Brand
 * consistency: same font, same paddings, same colour tokens, same stat
 * layout across every game on the storefront.
 *
 * Use inside <GameShell topbar={<GameTopbar … />}>.
 */
export function GameTopbar({
  title,
  score,
  showScore = false,
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

  const scorePill: GameTopbarStat[] =
    showScore && score !== undefined ? [{ label: 'Score', value: score, accent: true }] : [];
  const resolvedStats: GameTopbarStat[] = [...scorePill, ...(stats ?? [])];

  return (
    <>
      <div className={styles.bar}>
        <div className={styles.group}>
          {/* Catalog — back to store listing. A 2×2 grid, not a house: a house
              icon clashed with the browser's own "home" button on Android Chrome. */}
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
            <TopbarIconButton onClick={() => setShowRules(true)} ariaLabel="Game rules">
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
          {title !== undefined && <span className={styles.title}>{title}</span>}
        </div>

        <div className={`${styles.group} ${styles.groupEnd}`}>
          {resolvedStats.map((s) => (
            <Stat key={s.label} stat={s} />
          ))}
          {/* Play/Pause + Restart — opt-in for interactive games */}
          {onPlayPause !== undefined && (
            <TopbarIconButton
              onClick={onPlayPause}
              tone="ink"
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
            <TopbarIconButton onClick={onRestart} ariaLabel="Restart">
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
          <TopbarIconButton onClick={() => setShowAbout(true)} ariaLabel="About this game">
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
            tone={sound.muted ? 'muted' : 'accent'}
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
          {actions !== undefined && <div className={styles.actions}>{actions}</div>}
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
      {title !== undefined && <h1 className={styles.aboutHeading}>{title}</h1>}

      {extra !== undefined && <div className={styles.aboutExtra}>{extra}</div>}

      <dl className={styles.aboutGrid}>
        <dt>Version</dt>
        <dd>
          {version ? (
            <code className={styles.code}>{version}</code>
          ) : loaded ? (
            'development build'
          ) : (
            '…'
          )}
        </dd>
        {deployedAt && (
          <>
            <dt>Deployed</dt>
            <dd title={new Date(deployedAt).toLocaleString()}>{relativeTime(deployedAt)}</dd>
          </>
        )}
      </dl>

      <p className={styles.aboutNote}>
        A free game on{' '}
        <a
          href="https://freegamestore.online"
          target="_blank"
          rel="noopener noreferrer"
          className={styles.aboutLink}
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
      className={styles.overlay}
    >
      <div className={styles.overlayHeader}>
        <span className={styles.overlayTitle}>{title}</span>
        <TopbarIconButton ref={closeButtonRef} onClick={onClose} ariaLabel="Close">
          &times;
        </TopbarIconButton>
      </div>
      <div className={styles.overlayBody}>{children}</div>
    </div>
  );
}

function Stat({ stat }: { stat: GameTopbarStat }): React.JSX.Element {
  return (
    <div className={styles.stat}>
      <div className={`${styles.statValue} ${stat.accent === true ? styles.statAccent : ''}`}>
        {stat.value}
      </div>
      <div className={styles.statLabel}>{stat.label}</div>
    </div>
  );
}
