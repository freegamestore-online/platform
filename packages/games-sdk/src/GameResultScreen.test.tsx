import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONFETTI_COLOURS, Confetti } from './Confetti.js';
import { GameResultScreen, type GameResultScreenProps } from './GameResultScreen.js';
import * as sdk from './index.js';

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
    expect(container.querySelector('dl')).toBeNull();
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
    const confetti = container.querySelector('[data-fgs="confetti"]');
    expect(confetti).toHaveAttribute('aria-hidden', 'true');
    expect(confetti?.querySelectorAll('[data-fgs="confetti-piece"]').length).toBeGreaterThan(0);
  });

  it('shows no confetti for a loss', () => {
    const { container } = render(<GameResultScreen {...BASE} tone="lose" title="Game over" />);
    expect(container.querySelector('[data-fgs="confetti"]')).toBeNull();
    expect(container.querySelector('[data-tone="lose"]')).not.toBeNull();
  });

  it('hides the confetti for a win when the player prefers reduced motion', () => {
    stubReducedMotion(true);
    const { container } = render(<GameResultScreen {...BASE} tone="win" />);
    expect(container.querySelector('[data-fgs="confetti"]')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Level 4 cleared!' })).toBeInTheDocument();
  });

  it('keeps the confetti when reduced motion is not requested', () => {
    stubReducedMotion(false);
    const { container } = render(<GameResultScreen {...BASE} tone="win" />);
    expect(container.querySelector('[data-fgs="confetti"]')).not.toBeNull();
  });
});

describe('Confetti', () => {
  it('renders 30 pieces by default', () => {
    const { container } = render(<Confetti />);
    expect(container.querySelectorAll('[data-fgs="confetti-piece"]')).toHaveLength(30);
  });

  it('defaults the colours to theme variables with fallbacks', () => {
    expect(CONFETTI_COLOURS[0]).toBe('var(--accent, #2563eb)');
    expect(CONFETTI_COLOURS.every((c) => c.startsWith('var(--'))).toBe(true);
  });
});

describe('GameResultScreen styling', () => {
  it('exports no CSS string: styling is compiled utilities', () => {
    expect(Object.keys(sdk).filter((k) => /_CSS$/.test(k) && k !== 'GAME_TOKENS_CSS')).toEqual([]);
  });

  it('puts the card on an opaque panel surface, with only the scrim translucent', () => {
    const { container } = render(<GameResultScreen {...BASE} tone="lose" />);
    const overlay = container.querySelector('[data-fgs="result"]') as HTMLElement;
    const card = overlay.firstElementChild as HTMLElement;
    expect(card.className).toContain('bg-panel');
    expect(card.className).not.toMatch(/bg-panel\//);
    expect(overlay.className).toMatch(/bg-paper\/\d+/);
  });

  it('colours a win title with the accent and a loss title with the ink', () => {
    const { rerender } = render(<GameResultScreen {...BASE} tone="win" />);
    expect(screen.getByRole('heading', { level: 2 }).className).toContain('text-accent-ink');
    rerender(<GameResultScreen {...BASE} tone="lose" />);
    expect(screen.getByRole('heading', { level: 2 }).className).toContain('text-ink');
  });

  it('stops every animation under prefers-reduced-motion', () => {
    const { container } = render(<GameResultScreen {...BASE} tone="lose" />);
    const animated = [...container.querySelectorAll('[class*="animate-fgs-"]')];
    expect(animated.length).toBeGreaterThan(3);
    for (const el of animated) {
      expect(el.className, el.className).toContain('motion-reduce:animate-none');
    }
  });

  it('staggers each stat with a dynamic --i index only', () => {
    const { container } = render(<GameResultScreen {...BASE} tone="lose" />);
    const stats = [...container.querySelectorAll('dl > div')] as HTMLElement[];
    expect(stats.map((el) => el.style.getPropertyValue('--i'))).toEqual(['0', '1']);
    for (const el of stats) {
      expect(el.getAttribute('style')).toBe(`--i: ${el.style.getPropertyValue('--i')};`);
    }
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
