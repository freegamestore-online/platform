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
 * Renders as a centered overlay on top of the game board.
 */
export function GameOverScreen({ score, highScore, onPlayAgain, children }: GameOverScreenProps) {
  const isNewHigh = highScore !== undefined && score >= highScore && score > 0;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 800,
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
      }}
    >
      <div
        style={{
          textAlign: 'center',
          maxWidth: 320,
          width: '100%',
        }}
      >
        <div
          style={{
            fontSize: '0.75rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            color: 'rgba(255,255,255,0.6)',
            marginBottom: '0.5rem',
            fontFamily: '"Manrope", system-ui, sans-serif',
          }}
        >
          Game Over
        </div>

        <div
          style={{
            fontSize: '3rem',
            fontWeight: 800,
            color: '#ffffff',
            lineHeight: 1,
            marginBottom: '0.25rem',
            fontFamily: '"Fraunces", serif',
          }}
        >
          {score.toLocaleString()}
        </div>

        {highScore !== undefined && (
          <div
            style={{
              fontSize: '0.8rem',
              fontWeight: 600,
              color: isNewHigh ? 'var(--accent, #10b981)' : 'rgba(255,255,255,0.5)',
              marginBottom: '1rem',
              fontFamily: '"Manrope", system-ui, sans-serif',
            }}
          >
            {isNewHigh ? 'New high score!' : `Best: ${highScore.toLocaleString()}`}
          </div>
        )}

        {!highScore && <div style={{ marginBottom: '1rem' }} />}

        <GameButton onClick={onPlayAgain} variant="primary" size="lg">
          Play Again
        </GameButton>

        {children && (
          <div style={{ marginTop: '1rem', color: 'rgba(255,255,255,0.7)', fontSize: '0.85rem' }}>
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
