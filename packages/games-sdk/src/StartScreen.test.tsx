import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import * as sdk from './index.js';
import { StartScreen } from './StartScreen.js';

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
      <StartScreen
        title="Demo Game"
        howToPlay={STEPS}
        onHowToPlay={onHowToPlay}
        onPlay={() => {}}
      />,
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
    const { container } = render(
      <StartScreen title="Demo Game" artwork={null} onPlay={() => {}} />,
    );
    expect(container.querySelector('[data-fgs="start-artwork"]')).toBeNull();
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

describe('StartScreen styling', () => {
  it('exports no CSS string: styling is compiled utilities', () => {
    expect(Object.keys(sdk).filter((k) => /_CSS$/.test(k) && k !== 'GAME_TOKENS_CSS')).toEqual([]);
  });

  it('puts the card on an opaque panel surface', () => {
    const { container } = render(<StartScreen title="Demo Game" onPlay={() => {}} />);
    const card = container.querySelector('h1')?.parentElement as HTMLElement;
    expect(card.className).toContain('bg-panel');
    expect(card.className).not.toMatch(/bg-panel\//);
  });

  it('staggers the entrance through --delay classes, not inline styles', () => {
    const { container } = render(
      <StartScreen title="Demo Game" artwork={<span>art</span>} onPlay={() => {}} />,
    );
    const art = container.querySelector('[data-fgs="start-artwork"]') as HTMLElement;
    expect(art.className).toContain('[--delay:0ms]');
    expect(art.getAttribute('style')).toBeNull();
    const card = container.querySelector('h1')?.parentElement as HTMLElement;
    expect(card.className).toContain('[--delay:120ms]');
  });

  it('stops every animation under prefers-reduced-motion', () => {
    render(
      <StartScreen
        title="Demo Game"
        artwork={<span>art</span>}
        onPlay={() => {}}
        howToPlay={STEPS}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'How to play' }));
    const animated = [...document.querySelectorAll('[class*="animate-fgs-"]')];
    expect(animated.length).toBeGreaterThanOrEqual(4);
    for (const el of animated) {
      expect(el.className, el.className).toContain('motion-reduce:animate-none');
    }
  });

  it('numbers the how-to-play steps with a dynamic --i index only', () => {
    render(<StartScreen title="Demo Game" onPlay={() => {}} howToPlay={STEPS} />);
    fireEvent.click(screen.getByRole('button', { name: 'How to play' }));
    const li = document.querySelector('ol > li') as HTMLElement;
    expect(li.getAttribute('style')).toBe('--i: 0;');
  });
});

describe('backward compatibility', () => {
  it('keeps the existing SDK exports and adds StartScreen', () => {
    for (const name of [
      'GameShell',
      'GameTopbar',
      'GameButton',
      'GameModal',
      'GameOverScreen',
      'StartScreen',
    ]) {
      expect(sdk, name).toHaveProperty(name);
    }
  });
});
