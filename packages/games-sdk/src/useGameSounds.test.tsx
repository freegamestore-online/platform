import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { SoundProvider, useSound } from './SoundContext.js';
import { useGameSounds } from './useGameSounds.js';

// Minimal AudioContext mock that records construction + node creation.
let ctorCalls = 0;
class MockAudioContext {
  state = 'running';
  currentTime = 0;
  destination = {};
  constructor() {
    ctorCalls++;
  }
  createOscillator() {
    return { type: 'sine', frequency: { value: 0 }, connect() {}, start() {}, stop() {} };
  }
  createGain() {
    return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <SoundProvider>{children}</SoundProvider>
);

describe('useGameSounds — mute respect (compliance-critical)', () => {
  beforeEach(() => {
    ctorCalls = 0;
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = MockAudioContext;
  });

  it('creates NO AudioContext while muted (the default)', () => {
    const { result } = renderHook(() => useGameSounds(), { wrapper });
    act(() => {
      result.current.playScore();
      result.current.playMove();
      result.current.playGameOver();
    });
    expect(ctorCalls).toBe(0);
  });

  it('creates an AudioContext once the user unmutes', () => {
    const both = renderHook(() => ({ sounds: useGameSounds(), sound: useSound() }), { wrapper });
    expect(ctorCalls).toBe(0);
    act(() => both.result.current.sound.toggle()); // unmute (warm-up effect creates the ctx)
    expect(ctorCalls).toBeGreaterThan(0);
  });

  it('exposes the full sound API', () => {
    const { result } = renderHook(() => useGameSounds(), { wrapper });
    for (const fn of [
      'playMove',
      'playScore',
      'playError',
      'playGameOver',
      'playLevelUp',
      'playDrop',
      'playClear',
      'playTick',
    ]) {
      expect(typeof (result.current as Record<string, unknown>)[fn]).toBe('function');
    }
  });
});
