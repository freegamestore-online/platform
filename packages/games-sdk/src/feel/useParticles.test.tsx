import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useParticles } from './useParticles.js';

const BURST = { count: 5, speed: [100, 200] as const, size: [4, 6] as const, life: 0.5 };

/**
 * Drive requestAnimationFrame from the fake clock. Vitest's fake rAF passes a timestamp
 * that does not move with fake time, so the stub passes Date.now(), which does.
 */
function stubFrameClock() {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16) as unknown as number);
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

/** A canvas whose 2D context records draw calls. jsdom has no canvas, so the context is stubbed. */
function fakeCanvas() {
  const ctx = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    globalAlpha: 1,
    fillStyle: '',
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  const canvas = document.createElement('canvas');
  return { canvas, ctx };
}

describe('useParticles', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubFrameClock();
    setReducedMotion(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('publishes the live particle count on the canvas after a burst', () => {
    const { canvas, ctx } = fakeCanvas();
    const { result } = renderHook(() => useParticles({ current: canvas }));

    act(() => result.current.burst(50, 50, ['red'], BURST));
    act(() => {
      vi.advanceTimersByTime(20);
    });

    expect(canvas.dataset.particles).toBe('5');
    expect(ctx.fillRect).toHaveBeenCalled();
  });

  it('lets the particles expire and stops the loop', () => {
    const { canvas } = fakeCanvas();
    const { result } = renderHook(() => useParticles({ current: canvas }));

    act(() => result.current.burst(50, 50, ['red'], BURST));
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(canvas.dataset.particles).toBe('0');
  });

  it('launches nothing under reduced motion', () => {
    setReducedMotion(true);
    const { canvas, ctx } = fakeCanvas();
    const { result } = renderHook(() => useParticles({ current: canvas }));

    act(() => result.current.burst(50, 50, ['red'], BURST));
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(canvas.dataset.particles).toBeUndefined();
  });

  it('does nothing before the canvas is mounted', () => {
    const { result } = renderHook(() => useParticles({ current: null }));
    expect(() => act(() => result.current.burst(0, 0, ['red'], BURST))).not.toThrow();
  });

  it('keeps the same emitter across re-renders', () => {
    const { canvas } = fakeCanvas();
    const ref = { current: canvas };
    const { result, rerender } = renderHook(() => useParticles(ref));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it('cancels the frame loop on unmount, so nothing draws afterwards', () => {
    const { canvas, ctx } = fakeCanvas();
    const { result, unmount } = renderHook(() => useParticles({ current: canvas }));

    act(() => result.current.burst(50, 50, ['red'], BURST));
    unmount();
    const drawsAtUnmount = ctx.fillRect.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(ctx.fillRect.mock.calls.length).toBe(drawsAtUnmount);
  });
});
