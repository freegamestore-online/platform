import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as sdk from './index.js';
import { Confetti, CONFETTI_COLOURS } from './Confetti.js';
import { GameResultScreen, RESULT_SCREEN_CSS, type GameResultScreenProps } from './GameResultScreen.js';

const BASE: GameResultScreenProps = {
  tone: 'win',
  eyebrow: 'Level 4',
  title: 'Level 4 cleared!',
  stats: [
    { label: 'Moves', value: 12 },
    { label: 'Time', value: '0:42' },
  ],
  badge: 'New best!',
  action: { label: 'Next level', onClick: () => {} },
};

/** Stub window.matchMedia so `prefers-reduced-motion: reduce` matches (or not). */
function stubReducedMotion(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: matches && query === '(prefers-reduced-motion: reduce)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GameResultScreen', () => {
  it('is a labelled modal dialog named by its title', () => {
    render(<GameResultScreen {...BASE} />);
    const dialog = screen.getByRole('dialog', { name: 'Level 4 cleared!' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('shows the eyebrow, the title as a heading, the message and the badge', () => {
    render(<GameResultScreen {...BASE} message="Well played." />);
    expect(screen.getByText('Level 4')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Level 4 cleared!' })).toBeInTheDocument();
    expect(screen.getByText('Well played.')).toBeInTheDocument();
    expect(screen.getByText('New best!')).toBeInTheDocument();
  });

  it('shows stats as label and value pairs, stringifying numbers', () => {
    render(<GameResultScreen {...BASE} />);
    expect(screen.getByText('Moves').nextElementSibling).toHaveTextContent('12');
    expect(screen.getByText('Time').nextElementSibling).toHaveTextContent('0:42');
  });

  it('renders no stats list when stats is omitted', () => {
    const { container } = render(<GameResultScreen {...BASE} stats={undefined} />);
    expect(container.querySelector('.fgs-result-stats')).toBeNull();
  });

  it('calls action.onClick once when the action is pressed', () => {
    const onClick = vi.fn();
    render(<GameResultScreen {...BASE} action={{ label: 'Play again', onClick }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Play again' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('focuses the action when it opens, not an earlier button in the children', () => {
    render(
      <GameResultScreen {...BASE} action={{ label: 'Next level', onClick: () => {} }}>
        <button type="button">Submit score</button>
      </GameResultScreen>,
    );
    expect(screen.getByRole('button', { name: 'Next level' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Submit score' })).not.toHaveFocus();
  });

  it('renders children between the badge and the action', () => {
    render(
      <GameResultScreen {...BASE}>
        <p>Extra content</p>
      </GameResultScreen>,
    );
    const extra = screen.getByText('Extra content');
    const badge = screen.getByText('New best!');
    const action = screen.getByRole('button', { name: 'Next level' });
    expect(badge.compareDocumentPosition(extra) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(extra.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows confetti for a win', () => {
    const { container } = render(<GameResultScreen {...BASE} tone="win" />);
    const confetti = container.querySelector('.fgs-confetti');
    expect(confetti).toHaveAttribute('aria-hidden', 'true');
    expect(confetti?.querySelectorAll('.fgs-confetti-piece').length).toBeGreaterThan(0);
  });

  it('shows no confetti for a loss', () => {
    const { container } = render(<GameResultScreen {...BASE} tone="lose" title="Game over" />);
    expect(container.querySelector('.fgs-confetti')).toBeNull();
    expect(container.querySelector('.fgs-result-lose')).not.toBeNull();
  });

  it('hides the confetti for a win when the player prefers reduced motion', () => {
    stubReducedMotion(true);
    const { container } = render(<GameResultScreen {...BASE} tone="win" />);
    expect(container.querySelector('.fgs-confetti')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Level 4 cleared!' })).toBeInTheDocument();
  });

  it('keeps the confetti when reduced motion is not requested', () => {
    stubReducedMotion(false);
    const { container } = render(<GameResultScreen {...BASE} tone="win" />);
    expect(container.querySelector('.fgs-confetti')).not.toBeNull();
  });
});

describe('Confetti', () => {
  it('renders 30 pieces by default', () => {
    const { container } = render(<Confetti />);
    expect(container.querySelectorAll('.fgs-confetti-piece')).toHaveLength(30);
  });

  it('defaults the colours to theme variables with fallbacks', () => {
    expect(CONFETTI_COLOURS[0]).toBe('var(--accent, #2563eb)');
    expect(CONFETTI_COLOURS.every((c) => c.startsWith('var(--'))).toBe(true);
  });
});

describe('RESULT_SCREEN_CSS', () => {
  it('reads its durations and easings from the motion tokens, not from literals', () => {
    // A duration sits straight after the animation name. Stagger delays are offsets, so they may stay literal.
    const literalDuration = /animation:\s*[\w-]+\s+\d+ms\b/;
    expect(RESULT_SCREEN_CSS.split('\n').filter((line) => literalDuration.test(line))).toEqual([]);
    expect(RESULT_SCREEN_CSS).toContain('var(--motion-slow');
    expect(RESULT_SCREEN_CSS).toContain('var(--motion-base');
  });

  it('uses the fgs- class prefix throughout', () => {
    const classes = [...RESULT_SCREEN_CSS.matchAll(/\.([a-z][\w-]*)/g)].map((m) => m[1]);
    expect(classes.length).toBeGreaterThan(0);
    for (const name of classes) {
      expect(name, name).toMatch(/^(fgs-|\d|[a-z]+$)/);
    }
  });

  it('stops every animation under prefers-reduced-motion', () => {
    const reduced = RESULT_SCREEN_CSS.slice(RESULT_SCREEN_CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('.fgs-result-overlay');
    expect(reduced).toContain('animation: none');
  });
});

describe('backward compatibility', () => {
  it('keeps GameOverScreen exported, next to GameResultScreen', () => {
    expect(sdk).toHaveProperty('GameOverScreen');
    expect(sdk).toHaveProperty('GameResultScreen');
    expect(sdk).toHaveProperty('Confetti');
  });

  it('keeps GameOverScreen rendering its own play-again button', () => {
    render(<sdk.GameOverScreen score={10} onPlayAgain={() => {}} />);
    expect(screen.getByRole('button', { name: 'Play Again' })).toBeInTheDocument();
  });
});
