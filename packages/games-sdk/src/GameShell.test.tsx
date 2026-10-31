import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GameShell } from './GameShell.js';

describe('GameShell', () => {
  it('renders the game children', () => {
    render(
      <GameShell>
        <div data-testid="game">PLAY</div>
      </GameShell>,
    );
    expect(screen.getByTestId('game')).toHaveTextContent('PLAY');
  });

  it('renders the topbar only when provided', () => {
    const { rerender } = render(
      <GameShell>
        <div>g</div>
      </GameShell>,
    );
    expect(screen.queryByTestId('bar')).toBeNull();
    rerender(
      <GameShell topbar={<div data-testid="bar">SCORE</div>}>
        <div>g</div>
      </GameShell>,
    );
    expect(screen.getByTestId('bar')).toBeInTheDocument();
  });

  it('locks the no-scroll layout (compliance: no body scroll, 100svh, fixed)', () => {
    const { container } = render(
      <GameShell>
        <div>g</div>
      </GameShell>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    for (const cls of ['overflow-hidden', 'h-svh', 'fixed', 'select-none']) {
      expect(wrapper.className).toContain(cls);
    }
    expect(wrapper.getAttribute('style')).toBeNull();
  });

  it('includes the freegamestore.online store link (compliance)', () => {
    render(
      <GameShell>
        <div>g</div>
      </GameShell>,
    );
    const link = screen.getByRole('link', { name: /freegamestore\.online/i });
    expect(link).toHaveAttribute('href', 'https://freegamestore.online');
  });
});
