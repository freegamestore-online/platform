/**
 * @freegamestore/games — shared React UI primitives for FreeGameStore games.
 *
 * Why this exists:
 * - Games on the platform must be **brand-consistent** (no per-game custom
 *   topbars). The compliance suite enforces brand fonts and CSS tokens; the
 *   topbar is the next leak.
 * - Games must **fit the viewport** (no scrolling). GameShell hard-locks
 *   layout to 100svh and prevents overflow on the wrapper, so a game can't
 *   accidentally introduce vertical / horizontal scroll.
 *
 * What you get:
 *   <GameShell topbar={<GameTopbar score={42} />}>{your game}</GameShell>
 */

export { GameAuth } from './GameAuth.js';
export {
  GameButton,
  type GameButtonProps,
  type GameButtonSize,
  type GameButtonVariant,
} from './GameButton.js';
export { GameConfirm, type GameConfirmProps } from './GameConfirm.js';
export { GameModal, type GameModalProps } from './GameModal.js';
export { GameOverScreen, type GameOverScreenProps } from './GameOverScreen.js';
export { GameShell, type GameShellProps } from './GameShell.js';
export { GameTextSizeToggle } from './GameTextSizeToggle.js';
export { GameThemeToggle } from './GameThemeToggle.js';
export {
  GameTopbar,
  type GameTopbarProps,
  type GameTopbarStat,
} from './GameTopbar.js';
export { Leaderboard, type LeaderboardProps } from './Leaderboard.js';
export { useSound } from './SoundContext.js';
export { type User, useAuth } from './useAuth.js';
export { useGameSounds } from './useGameSounds.js';
export {
  type LeaderboardEntry,
  useLeaderboard,
} from './useLeaderboard.js';
