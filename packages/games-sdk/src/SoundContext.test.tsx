import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SoundProvider, useSound } from './SoundContext.js';

const wrapper = ({ children }: { children: ReactNode }) => (
  <SoundProvider>{children}</SoundProvider>
);

describe('SoundContext', () => {
  it('defaults to MUTED (compliance: no audio until the user opts in)', () => {
    const { result } = renderHook(() => useSound(), { wrapper });
    expect(result.current.muted).toBe(true);
  });

  it('toggle flips mute state', () => {
    const { result } = renderHook(() => useSound(), { wrapper });
    act(() => result.current.toggle());
    expect(result.current.muted).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.muted).toBe(true);
  });

  it('useSound outside a provider is muted by default (safe fallback)', () => {
    const { result } = renderHook(() => useSound());
    expect(result.current.muted).toBe(true);
    expect(typeof result.current.toggle).toBe('function');
  });

  // #410: a game calling useGameSounds() in App, above <GameShell>, stayed muted
  // forever while the topbar toggled the provider's own state.
  it('outside a provider, follows the toggle made inside it (the topbar)', () => {
    const outside = renderHook(() => useSound());
    const inside = renderHook(() => useSound(), { wrapper });
    act(() => inside.result.current.toggle());
    expect(outside.result.current.muted).toBe(false);
    act(() => outside.result.current.toggle());
    expect(inside.result.current.muted).toBe(true);
  });

  it('warns once in development when called outside <GameShell>, never inside', async () => {
    vi.resetModules();
    const fresh = await import('./SoundContext.js');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderHook(() => fresh.useSound(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <fresh.SoundProvider>{children}</fresh.SoundProvider>
      ),
    });
    expect(warn).not.toHaveBeenCalled();
    renderHook(() => fresh.useSound());
    renderHook(() => fresh.useSound());
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('outside <GameShell>');
    warn.mockRestore();
  });
});
