import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCORE_POP_MS, ScorePopup } from './ScorePopup.js';

/**
 * Drive requestAnimationFrame from the fake clock. Vitest's fake rAF passes a timestamp
 * that does not move with fake time, so the stub passes Date.now(), which does.
 */
function stubFrameClock() {
  vi.stubGlobal(
    'requestAnimationFrame',
    (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16) as unknown as number,
  );
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
}

function setReducedMotion(reduce: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query.includes('reduce'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

describe('ScorePopup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubFrameClock();
    setReducedMotion(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('renders the points as +N', () => {
    render(<ScorePopup points={300} x={10} y={20} onDone={() => {}} />);
    expect(screen.getByText('+300')).toBeInTheDocument();
  });

  it('rises and fades, then calls onDone once it has finished', () => {
    const onDone = vi.fn();
    render(<ScorePopup points={300} x={10} y={20} onDone={onDone} />);
    const pop = screen.getByText('+300');

    act(() => {
      vi.advanceTimersByTime(SCORE_POP_MS / 2);
    });
    expect(pop.style.transform).toContain('calc(-50% + -');
    expect(Number(pop.style.opacity)).toBeLessThan(1);
    expect(onDone).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(SCORE_POP_MS);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('under reduced motion holds still, shows the number, and still calls onDone', () => {
    setReducedMotion(true);
    const onDone = vi.fn();
    render(<ScorePopup points={300} x={10} y={20} onDone={onDone} />);
    const pop = screen.getByText('+300');

    act(() => {
      vi.advanceTimersByTime(SCORE_POP_MS / 2);
    });
    expect(pop.style.opacity).toBe('');
    expect(pop.style.transform).toBe('translate(-50%, -50%)');
    expect(onDone).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(SCORE_POP_MS);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('places the pop-up at x and y', () => {
    render(<ScorePopup points={5} x={12} y={34} onDone={() => {}} />);
    const pop = screen.getByText('+5');
    expect(pop.style.left).toBe('12px');
    expect(pop.style.top).toBe('34px');
  });
});
