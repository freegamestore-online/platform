import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHaptics } from './useHaptics.js';

describe('useHaptics', () => {
  let vibrateFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vibrateFn = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, 'vibrate', { value: vibrateFn, configurable: true });
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'vibrate');
  });

  it('pulses through the Vibration API by default', () => {
    const { result } = renderHook(() => useHaptics());
    result.current.pulse([12, 40, 18]);
    expect(vibrateFn).toHaveBeenCalledWith([12, 40, 18]);
  });

  it('stays silent when disabled', () => {
    const { result } = renderHook(() => useHaptics(false));
    result.current.pulse(10);
    expect(vibrateFn).not.toHaveBeenCalled();
  });

  it('keeps the same object while enabled is unchanged', () => {
    const { result, rerender } = renderHook(({ on }) => useHaptics(on), { initialProps: { on: true } });
    const first = result.current;
    rerender({ on: true });
    expect(result.current).toBe(first);
    rerender({ on: false });
    expect(result.current).not.toBe(first);
  });

  it('is not switched off by reduced motion', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} })),
    );
    const { result } = renderHook(() => useHaptics());
    result.current.pulse(10);
    expect(vibrateFn).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
