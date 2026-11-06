import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameTopbar } from './GameTopbar.js';
import { GAME_TOKENS_CSS } from './tokens.js';

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
    expect(value.className).toMatch(/var\(--accent\)/);
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

  it('injects no <style> element, because Tailwind utilities style the topbar', () => {
    const { container } = render(<GameTopbar title="Demo" score={1} />);
    expect(container.querySelector('style')).toBeNull();
  });

  it('gives every control the shared button class', () => {
    render(<GameTopbar title="Demo" score={1} onRestart={() => {}} />);
    for (const name of ['Browse all games', 'About this game', 'Mute', 'Restart']) {
      expect(
        screen.getByRole(name === 'Browse all games' ? 'link' : 'button', { name }).className,
      ).toMatch(/min-h-11/);
    }
  });

  it('renders the catalog as a link that opens the store in a new tab', () => {
    render(<GameTopbar title="Demo" />);
    const catalog = screen.getByRole('link', { name: 'Browse all games' });
    expect(catalog).toHaveAttribute('href', 'https://freegamestore.online');
    expect(catalog).toHaveAttribute('target', '_blank');
    expect(catalog.className).toMatch(/no-underline/);
  });

  it('uses the ink tone for the pause control', () => {
    render(<GameTopbar onPlayPause={() => {}} />);
    expect(screen.getByRole('button', { name: 'Pause' }).className).toMatch(/var\(--ink,/);
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
    expect(dialog.className).toMatch(/fixed inset-0/);
    expect(screen.getByText('Rules text')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the About overlay from its button and closes it with the close button', () => {
    render(<GameTopbar title="Demo Game" />);
    fireEvent.click(screen.getByRole('button', { name: 'About this game' }));

    expect(screen.getByRole('dialog', { name: 'About' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Demo Game' }).className).toMatch(/mb-3/);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // #414: on a 320px screen the stats are what gives way, never a control.
  it('groups the stats in one clippable container, apart from the controls', () => {
    render(
      <GameTopbar
        title="Tetris"
        stats={[
          { label: 'Lines', value: 12 },
          { label: 'Level', value: 3 },
        ]}
        actions={<button type="button">Sign in</button>}
      />,
    );
    const stats = screen.getByText('Lines').closest('[class*="flex-wrap"]');
    expect(stats).not.toBeNull();
    expect(stats).toContainElement(screen.getByText('Level'));
    expect(stats).not.toContainElement(screen.getByRole('button', { name: 'Sign in' }));
    expect(stats).not.toContainElement(screen.getByRole('button', { name: 'Mute' }));
  });

  it('renders no stats container when there are no stats', () => {
    const { container } = render(<GameTopbar title="Tetris" />);
    expect(container.querySelector('[class*="flex-wrap"]')).toBeNull();
  });

  it('keeps the sound toggle aria-pressed in step with its state', () => {
    render(<GameTopbar />);
    const mute = screen.getByRole('button', { name: 'Mute' });
    expect(mute).toHaveAttribute('aria-pressed');
  });
});

describe('GameTopbar styles', () => {
  /** The class string of the first element matching `selector` in a fresh render. */
  const classes = (ui: React.ReactElement, selector: string): string => {
    const { container, unmount } = render(ui);
    const found = container.querySelector(selector)?.className ?? '';
    unmount();
    return found;
  };
  const bar = <GameTopbar title="Demo" stats={[{ label: 'Lives', value: 3 }]} />;

  it('styles the pseudo-states that inline styles could not express', () => {
    const button = classes(bar, '[data-fgs-tb-btn]');
    expect(button).toContain('active:opacity-[0.55]');
    expect(button).toContain('focus-visible:outline-2');
    expect(button).toContain('focus-visible:outline-[color:var(--accent');
  });

  it('times its transition with the motion tokens, not a bare literal', () => {
    const button = classes(bar, '[data-fgs-tb-btn]');
    expect(button).toContain('var(--motion-duration');
    expect(button).toContain('var(--motion-easing');
  });

  it('turns the button transition off under prefers-reduced-motion', () => {
    expect(classes(bar, '[data-fgs-tb-btn]')).toContain('motion-reduce:transition-none');
  });

  describe('on phones, 480px and below (#414)', () => {
    it('keeps the controls 44px tall while narrowing them', () => {
      const button = classes(bar, '[data-fgs-tb-btn]');
      expect(button).toContain('min-h-11');
      expect(button).toContain('max-[480px]:min-w-7');
      expect(button).not.toContain('max-[480px]:min-h');
    });

    it('hides stat labels visually but keeps them for screen readers', () => {
      render(bar);
      const label = screen.getByText('Lives');
      expect(label.className).toContain('max-[480px]:[clip-path:inset(50%)]');
      expect(label.className).not.toContain('max-[480px]:hidden');
    });

    it('truncates the title instead of letting it collapse to nothing', () => {
      render(bar);
      const title = screen.getByText('Demo').className;
      expect(title).toContain('text-ellipsis');
      expect(title).toContain('min-w-10');
    });

    it('lets only the stats shrink: controls, actions and stat items do not', () => {
      const { container } = render(bar);
      const stats = container.querySelector('[class*="flex-wrap"]')?.className ?? '';
      expect(stats).toContain('min-w-0');
      expect(stats).toContain('overflow-hidden');
      expect(container.querySelector('[data-fgs-tb-btn]')?.className).toContain('shrink-0');
      expect(screen.getByText('Lives').parentElement?.className).toContain('shrink-0');
      cleanup();
      const { container: withActions } = render(<GameTopbar actions={<i />} />);
      expect(withActions.querySelector('i')?.parentElement?.className).toContain('shrink-0');
    });
  });

  it('gives each tone its own colour class, so the colour is not set inline', () => {
    render(<GameTopbar onPlayPause={() => {}} />);
    expect(screen.getByRole('button', { name: 'Pause' }).className).toContain('var(--ink,');
    cleanup();
    render(<GameTopbar />);
    expect(screen.getByRole('button', { name: 'Mute' }).className).toMatch(
      /var\(--(?:muted|accent),/,
    );
  });

  it('is TypeScript, so the build only copies theme.css and dist has no CSS import (#512)', () => {
    expect(PKG.scripts.build).toContain('cp src/theme.css dist/');
    expect(PKG.scripts.build).not.toContain('module.css');
  });

  it('the motion tokens it reads are declared by GAME_TOKENS_CSS', () => {
    expect(GAME_TOKENS_CSS).toContain('--motion-duration: var(--motion-fast);');
    expect(GAME_TOKENS_CSS).toContain('--motion-easing: var(--motion-ease-out);');
  });
});
