import type { ReactNode } from 'react';
import { GameButton } from './GameButton.js';

export interface GameOverScreenProps {
  /** Final score to display. */
  score: number;
  /** Personal best (if available). */
  highScore?: number;
  /** Called when user taps "Play Again". */
  onPlayAgain: () => void;
  /** Optional extra content below the score (leaderboard link, stats, etc.). */
  children?: ReactNode;
}

/**
 * Standard game-over overlay. Shows score, optional high score,
 * play again button, and optional extra content.
 * Renders as a centered overlay on top of the game board. The text sits on a
 * dark scrim, so it uses white rather than the page tokens.
 */
export function GameOverScreen({ score, highScore, onPlayAgain, children }: GameOverScreenProps) {
  const isNewHigh = highScore !== undefined && score >= highScore && score > 0;

  return (
    <div className="absolute inset-0 z-[800] flex items-center justify-center bg-black/65 p-6 backdrop-blur-[6px]">
      <div className="w-full max-w-80 text-center">
        <div className="mb-2 text-xs font-bold uppercase tracking-widest text-white/60">
          Game Over
        </div>

        <div className="mb-1 font-display text-5xl font-extrabold leading-none text-white">
          {score.toLocaleString()}
        </div>

        {highScore !== undefined && (
          <div
            className={`mb-4 text-[0.8rem] font-semibold ${isNewHigh ? 'text-accent' : 'text-white/50'}`}
          >
            {isNewHigh ? 'New high score!' : `Best: ${highScore.toLocaleString()}`}
          </div>
        )}

        {!highScore && <div className="mb-4" />}

        <GameButton onClick={onPlayAgain} variant="primary" size="lg">
          Play Again
        </GameButton>

        {children && <div className="mt-4 text-[0.85rem] text-white/70">{children}</div>}
      </div>
    </div>
  );
}
