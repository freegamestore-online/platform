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

export {
  CONFETTI_COLOURS,
  Confetti,
  type ConfettiProps,
} from './Confetti.js';
export * from './feel/index.js';
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
export {
  GameResultScreen,
  type GameResultScreenProps,
  type GameResultStat,
} from './GameResultScreen.js';
export { GameShell, type GameShellProps } from './GameShell.js';
export { GameTextSizeToggle } from './GameTextSizeToggle.js';
export { GameThemeToggle } from './GameThemeToggle.js';
export {
  GameTopbar,
  type GameTopbarProps,
  type GameTopbarStat,
} from './GameTopbar.js';
// Re-exported (zap-drills#6): hiding them in 0.18 (issue #31) broke games that
// already imported them. The store UI still does not surface leaderboards.
export { Leaderboard, type LeaderboardProps } from './Leaderboard.js';
export { useSound } from './SoundContext.js';
export {
  StartScreen,
  type StartScreenProps,
  type StartScreenStep,
} from './StartScreen.js';
export {
  type ColourTokens,
  DARK_COLOUR_OVERRIDES,
  DARK_COLOURS,
  GAME_TOKENS_CSS,
  LIGHT_COLOURS,
  MOTION_TOKENS,
  type MotionTokens,
  REDUCED_MOTION_DURATIONS,
  SHAPE_TOKENS,
  type ShapeTokens,
  TYPOGRAPHY_TOKENS,
  type TypographyTokens,
} from './tokens.js';
export { type User, useAuth } from './useAuth.js';
export { useGameSounds } from './useGameSounds.js';
export {
  type LeaderboardEntry,
  type UseLeaderboardOptions,
  useLeaderboard,
} from './useLeaderboard.js';
