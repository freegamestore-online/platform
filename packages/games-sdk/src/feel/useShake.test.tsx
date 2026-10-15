import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useShake } from './useShake.js';

function setReducedMotion(reduce: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query.includes('reduce'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

describe('useShake', () => {
  let animate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    animate = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'animate', { value: animate, configurable: true });
    setReducedMotion(false);
  });

  afterEach(() => {
    Reflect.deleteProperty(HTMLElement.prototype, 'animate');
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('animates the element with a short shake', () => {
    const ref = { current: document.createElement('div') };
    const { result } = renderHook(() => useShake(ref, { amplitude: 3, duration: 200 }));

    result.current();

    expect(animate).toHaveBeenCalledTimes(1);
    const [keyframes, options] = animate.mock.calls[0] as [Keyframe[], KeyframeAnimationOptions];
    expect(keyframes.length).toBeGreaterThan(2);
    expect(options).toEqual({ duration: 200, easing: 'ease-out' });
  });

  it('uses the default amplitude and duration', () => {
    const ref = { current: document.createElement('div') };
    const { result } = renderHook(() => useShake(ref));
    result.current();
    expect(animate.mock.calls[0]![1]).toEqual({ duration: 320, easing: 'ease-out' });
  });

  it('does not shake under reduced motion', () => {
    setReducedMotion(true);
    const ref = { current: document.createElement('div') };
    const { result } = renderHook(() => useShake(ref));
    result.current();
    expect(animate).not.toHaveBeenCalled();
  });

  it('does nothing when there is no element yet, or no Web Animations API', () => {
    const { result } = renderHook(() => useShake({ current: null }));
    expect(() => result.current()).not.toThrow();
    expect(animate).not.toHaveBeenCalled();

    Reflect.deleteProperty(HTMLElement.prototype, 'animate');
    const ref = { current: document.createElement('div') };
    const { result: noApi } = renderHook(() => useShake(ref));
    expect(() => noApi.current()).not.toThrow();
  });
});
