import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SoundProvider, useSound } from './SoundContext.js';
import { useGameSounds } from './useGameSounds.js';

// #99: multi-note sounds schedule their later notes with setTimeout. Unmount
// closed the AudioContext but never cancelled those timers, so a note firing
// afterwards created a NEW context that nothing closed — one leaked context per
// game swapped out mid-sound, until the browser's cap silences all audio.

let created = 0;
let closed = 0;
let oscillators = 0;
class MockAudioContext {
  state = 'running';
  currentTime = 0;
  destination = {};
  constructor() {
    created++;
  }
  createOscillator() {
    oscillators++;
    return { type: 'sine', frequency: { value: 0 }, connect() {}, start() {}, stop() {} };
  }
  createGain() {
    return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    closed++;
    return Promise.resolve();
  }
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <SoundProvider>{children}</SoundProvider>
);

function mountUnmuted() {
  const hook = renderHook(() => ({ sounds: useGameSounds(), sound: useSound() }), { wrapper });
  act(() => hook.result.current.sound.toggle()); // unmute → context created
  return hook;
}

beforeEach(() => {
  vi.useFakeTimers();
  created = 0;
  closed = 0;
  oscillators = 0;
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = MockAudioContext;
});
afterEach(() => vi.useRealTimers());

describe('useGameSounds unmount (#99)', () => {
  it('does not create a new AudioContext when a delayed note fires after unmount', () => {
    const { result, unmount } = mountUnmuted();
    expect(created).toBe(1);
    act(() => result.current.sounds.playGameOver()); // two notes still pending
    unmount();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(created).toBe(1); // no leaked replacement context
    expect(closed).toBe(1);
  });

  it('cancels every pending note on unmount', () => {
    const { result, unmount } = mountUnmuted();
    act(() => {
      result.current.sounds.playLevelUp();
      result.current.sounds.playClear();
    });
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('still plays every note of a multi-note sound while mounted', () => {
    const { result } = mountUnmuted();
    act(() => result.current.sounds.playLevelUp());
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(oscillators).toBe(4);
    expect(vi.getTimerCount()).toBe(0);
  });
});
