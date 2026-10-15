import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import * as sdk from './index.js';
import { START_SCREEN_CSS, StartScreen } from './StartScreen.js';

const STEPS = [{ heading: 'Tap a tile', text: 'It joins the tray.' }];

describe('StartScreen', () => {
  it('shows the title and calls onPlay from the Play button', () => {
    const onPlay = vi.fn();
    render(<StartScreen title="Demo Game" onPlay={onPlay} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Demo Game' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it('uses a custom play label', () => {
    render(<StartScreen title="Demo Game" playLabel="Start" onPlay={() => {}} />);
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
  });

  it('shows the tagline when one is given', () => {
    render(<StartScreen title="Demo Game" tagline="Match the tiles." onPlay={() => {}} />);
    expect(screen.getByText('Match the tiles.')).toBeInTheDocument();
  });

  it('hides How to play when neither steps nor a callback are given', () => {
    render(<StartScreen title="Demo Game" onPlay={() => {}} />);
    expect(screen.queryByRole('button', { name: 'How to play' })).toBeNull();
  });

  it('opens the built-in overlay from howToPlay steps and closes it with the close button', () => {
    render(<StartScreen title="Demo Game" howToPlay={STEPS} onPlay={() => {}} />);
    expect(screen.queryByText('Tap a tile')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'How to play' }));
    expect(screen.getByText('Tap a tile')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('Tap a tile')).toBeNull();
  });

  it('closes the built-in overlay on Escape', () => {
    render(<StartScreen title="Demo Game" howToPlay={STEPS} onPlay={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'How to play' }));

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Tap a tile')).toBeNull();
  });

  it('calls onHowToPlay instead of opening the built-in overlay', () => {
    const onHowToPlay = vi.fn();
    render(
      <StartScreen title="Demo Game" howToPlay={STEPS} onHowToPlay={onHowToPlay} onPlay={() => {}} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'How to play' }));
    expect(onHowToPlay).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Tap a tile')).toBeNull();
  });

  it('shows How to play for onHowToPlay alone, without steps', () => {
    const onHowToPlay = vi.fn();
    render(<StartScreen title="Demo Game" onHowToPlay={onHowToPlay} onPlay={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'How to play' }));
    expect(onHowToPlay).toHaveBeenCalledTimes(1);
  });

  it('hides the artwork from assistive technology', () => {
    render(<StartScreen title="Demo Game" artwork={<p>artwork</p>} onPlay={() => {}} />);
    expect(screen.getByText('artwork').closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('renders no artwork wrapper when artwork is null', () => {
    const { container } = render(<StartScreen title="Demo Game" artwork={null} onPlay={() => {}} />);
    expect(container.querySelector('.fgs-start-artwork')).toBeNull();
  });

  it('labels the section with the title', () => {
    render(<StartScreen title="Demo Game" onPlay={() => {}} />);
    const section = screen.getByRole('region', { name: 'Demo Game' });
    expect(section).toBeInTheDocument();
  });

  it('gives two screens on one page distinct title ids', () => {
    const { container } = render(
      <>
        <StartScreen title="One" onPlay={() => {}} />
        <StartScreen title="Two" onPlay={() => {}} />
      </>,
    );
    const ids = [...container.querySelectorAll('h1')].map((h) => h.id);
    expect(ids[0]).not.toBe(ids[1]);
  });
});

describe('START_SCREEN_CSS', () => {
  it('reads its durations and easings from the motion tokens, not from literals', () => {
    expect(START_SCREEN_CSS).toContain('var(--motion-slow');
    expect(START_SCREEN_CSS).toContain('var(--motion-base');
    expect(START_SCREEN_CSS).not.toMatch(/(520|380)ms/);
  });

  it('falls back to the #209 light values, so it works without GAME_TOKENS_CSS', () => {
    expect(START_SCREEN_CSS).toContain('var(--paper, #ffffff)');
    expect(START_SCREEN_CSS).toContain('var(--accent, #2563eb)');
  });

  it('stops every animation under prefers-reduced-motion', () => {
    const reduced = START_SCREEN_CSS.slice(START_SCREEN_CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('.fgs-start-enter');
    expect(reduced).toContain('animation: none');
  });
});

describe('backward compatibility', () => {
  it('keeps the existing SDK exports and adds StartScreen', () => {
    for (const name of ['GameShell', 'GameTopbar', 'GameButton', 'GameModal', 'GameOverScreen', 'StartScreen']) {
      expect(sdk, name).toHaveProperty(name);
    }
  });
});
