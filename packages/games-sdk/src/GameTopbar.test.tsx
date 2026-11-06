import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameTopbar } from './GameTopbar.js';
import { TOPBAR_CSS as CSS } from './GameTopbar.styles.js';
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

  it('renders its styles once in <head>, however many bars there are', () => {
    render(
      <>
        <GameTopbar title="A" />
        <GameTopbar title="B" />
      </>,
    );
    const sheets = [...document.head.querySelectorAll('style')].filter((el) =>
      el.textContent?.includes('.fgs-tb-bar'),
    );
    expect(sheets).toHaveLength(1);
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
    const stats = screen.getByText('Lines').closest('[class*="stats"]');
    expect(stats).not.toBeNull();
    expect(stats).toContainElement(screen.getByText('Level'));
    expect(stats).not.toContainElement(screen.getByRole('button', { name: 'Sign in' }));
    expect(stats).not.toContainElement(screen.getByRole('button', { name: 'Mute' }));
  });

  it('renders no stats container when there are no stats', () => {
    const { container } = render(<GameTopbar title="Tetris" />);
    expect(container.querySelector('[class*="stats"]')).toBeNull();
  });

  it('keeps the sound toggle aria-pressed in step with its state', () => {
    render(<GameTopbar />);
    const mute = screen.getByRole('button', { name: 'Mute' });
    expect(mute).toHaveAttribute('aria-pressed');
  });
});

describe('GameTopbar styles (GameTopbar.styles.ts)', () => {
  it('styles the pseudo-states that inline styles could not express', () => {
    expect(CSS).toContain('.fgs-tb-button:active');
    expect(CSS).toContain('.fgs-tb-button:focus-visible');
    expect(CSS).toContain('outline: 2px solid var(--accent');
  });

  it('times its transition with the motion tokens, not a bare literal', () => {
    expect(CSS).toContain('var(--motion-duration');
    expect(CSS).toContain('var(--motion-easing');
  });

  it('turns the button transition off under prefers-reduced-motion', () => {
    const reduced = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('.fgs-tb-button');
    expect(reduced).toContain('transition: none');
  });

  describe('on phones, 480px and below (#414)', () => {
    const narrow = CSS.slice(
      CSS.indexOf('@media (max-width: 480px)'),
      CSS.indexOf('@media (prefers-reduced-motion'),
    );
    /** The declarations of `selector` inside the narrow-screen block. */
    const rule = (selector: string) => {
      const start = narrow.indexOf(`${selector} {`);
      return start < 0 ? '' : narrow.slice(start, narrow.indexOf('}', start));
    };

    it('has a narrow-screen block', () => {
      expect(narrow).toContain('@media (max-width: 480px)');
    });

    it('keeps the controls 44px tall while narrowing them', () => {
      expect(rule('.fgs-tb-button')).toContain('min-width: 1.75rem');
      expect(narrow).not.toContain('min-height');
    });

    it('hides stat labels visually but keeps them for screen readers', () => {
      expect(rule('.fgs-tb-statLabel')).toContain('clip-path: inset(50%)');
      expect(narrow).not.toContain('display: none');
    });

    it('truncates the title instead of letting it collapse to nothing', () => {
      expect(CSS).toMatch(/\.fgs-tb-title \{[^}]*text-overflow: ellipsis;[^}]*min-width: 2\.5rem/);
    });

    it('lets only the stats shrink: controls, actions and stats items do not', () => {
      expect(CSS).toMatch(
        /\.fgs-tb-stats \{[^}]*flex-wrap: wrap;[^}]*min-width: 0;[^}]*overflow: hidden/,
      );
      for (const sel of ['button', 'actions', 'stat']) {
        expect(CSS).toMatch(new RegExp(`\\.fgs-tb-${sel} \\{[^}]*flex-shrink: 0`));
      }
    });
  });

  it('gives each tone a class, so the colour is not set inline', () => {
    for (const tone of ['toneMuted', 'toneInk', 'toneAccent']) {
      expect(CSS).toContain(`.fgs-tb-${tone} {`);
    }
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
