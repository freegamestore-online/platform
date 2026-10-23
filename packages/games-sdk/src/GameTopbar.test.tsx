import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameTopbar } from './GameTopbar.js';
import { GAME_TOKENS_CSS } from './tokens.js';

const CSS = readFileSync(resolve(__dirname, 'GameTopbar.module.css'), 'utf8');
const PKG = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

describe('GameTopbar', () => {
  beforeEach(() => {
    // The About panel fetches /version.json. Fail it, so the panel shows its dev-build state.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('hides the score pill by default, even when score is passed (#348)', () => {
    render(<GameTopbar title="Demo Game" score={42} />);
    expect(screen.getByText('Demo Game')).toBeInTheDocument();
    expect(screen.queryByText('42')).toBeNull();
    expect(screen.queryByText('Score')).toBeNull();
  });

  it('shows the score pill when showScore is set (#348)', () => {
    render(<GameTopbar title="Demo Game" score={42} showScore />);
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('Score')).toBeInTheDocument();
  });

  it('shows no score pill with showScore set but no score value', () => {
    render(<GameTopbar title="Demo Game" showScore />);
    expect(screen.queryByText('Score')).toBeNull();
  });

  it('still renders custom stats after the score pill was removed (#348)', () => {
    render(<GameTopbar title="Demo Game" score={42} stats={[{ label: 'Lives', value: 3 }]} />);
    expect(screen.getByText('Lives')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.queryByText('42')).toBeNull();
  });

  it('marks an accent stat with the accent class', () => {
    render(<GameTopbar stats={[{ label: 'Lives', value: 3, accent: true }]} />);
    const value = screen.getByText('3');
    expect(value.className).toMatch(/statAccent/);
  });

  it('does not add a style attribute to any topbar control', () => {
    const { container } = render(
      <GameTopbar
        title="Demo"
        score={1}
        rules={<p>Rules</p>}
        onPlayPause={() => {}}
        onRestart={() => {}}
      />,
    );
    for (const control of container.querySelectorAll('[data-fgs-tb-btn]')) {
      expect(control.getAttribute('style')).toBeNull();
    }
  });

  it('injects no <style> element, because the module styles the topbar', () => {
    const { container } = render(<GameTopbar title="Demo" score={1} />);
    expect(container.querySelector('style')).toBeNull();
  });

  it('gives every control the shared button class', () => {
    render(<GameTopbar title="Demo" score={1} onRestart={() => {}} />);
    for (const name of ['Browse all games', 'About this game', 'Mute', 'Restart']) {
      expect(
        screen.getByRole(name === 'Browse all games' ? 'link' : 'button', { name }).className,
      ).toMatch(/button/);
    }
  });

  it('renders the catalog as a link that opens the store in a new tab', () => {
    render(<GameTopbar title="Demo" />);
    const catalog = screen.getByRole('link', { name: 'Browse all games' });
    expect(catalog).toHaveAttribute('href', 'https://freegamestore.online');
    expect(catalog).toHaveAttribute('target', '_blank');
    expect(catalog.className).toMatch(/link/);
  });

  it('uses the ink tone for the pause control', () => {
    render(<GameTopbar onPlayPause={() => {}} />);
    expect(screen.getByRole('button', { name: 'Pause' }).className).toMatch(/toneInk/);
  });

  it('shows the rules button only when rules are given', () => {
    const { rerender } = render(<GameTopbar title="Demo" />);
    expect(screen.queryByRole('button', { name: 'Game rules' })).toBeNull();
    rerender(<GameTopbar title="Demo" rules={<p>Rules text</p>} />);
    expect(screen.getByRole('button', { name: 'Game rules' })).toBeInTheDocument();
  });

  it('opens the rules overlay as a labelled dialog and closes it on Escape', () => {
    render(<GameTopbar rules={<p>Rules text</p>} />);
    fireEvent.click(screen.getByRole('button', { name: 'Game rules' }));

    const dialog = screen.getByRole('dialog', { name: 'How to Play' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.className).toMatch(/overlay/);
    expect(screen.getByText('Rules text')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the About overlay from its button and closes it with the close button', () => {
    render(<GameTopbar title="Demo Game" />);
    fireEvent.click(screen.getByRole('button', { name: 'About this game' }));

    expect(screen.getByRole('dialog', { name: 'About' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Demo Game' }).className).toMatch(
      /aboutHeading/,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the sound toggle aria-pressed in step with its state', () => {
    render(<GameTopbar />);
    const mute = screen.getByRole('button', { name: 'Mute' });
    expect(mute).toHaveAttribute('aria-pressed');
  });
});

describe('GameTopbar.module.css', () => {
  it('styles the pseudo-states that inline styles could not express', () => {
    expect(CSS).toContain('.button:active');
    expect(CSS).toContain('.button:focus-visible');
    expect(CSS).toContain('outline: 2px solid var(--accent');
  });

  it('times its transition with the motion tokens, not a bare literal', () => {
    expect(CSS).toContain('var(--motion-duration');
    expect(CSS).toContain('var(--motion-easing');
  });

  it('turns the button transition off under prefers-reduced-motion', () => {
    const reduced = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('.button');
    expect(reduced).toContain('transition: none');
  });

  it('gives each tone a class, so the colour is not set inline', () => {
    for (const tone of ['toneMuted', 'toneInk', 'toneAccent']) {
      expect(CSS).toContain(`.${tone} {`);
    }
  });

  it('is copied into dist by the build, since tsc does not copy CSS', () => {
    expect(PKG.scripts.build).toContain('cp src/GameTopbar.module.css dist/');
  });

  it('the motion tokens it reads are declared by GAME_TOKENS_CSS', () => {
    expect(GAME_TOKENS_CSS).toContain('--motion-duration: var(--motion-fast);');
    expect(GAME_TOKENS_CSS).toContain('--motion-easing: var(--motion-ease-out);');
  });
});
