import { useCallback, useEffect, useRef } from 'react';
import { useSound } from './SoundContext.js';

/**
 * Synthesized game sound effects via Web Audio API.
 * Zero audio files — works offline, no downloads.
 * All sounds respect the SDK mute toggle automatically.
 */
export function useGameSounds() {
  const { muted } = useSound();
  const ctxRef = useRef<AudioContext | null>(null);

  // Release the AudioContext when the game unmounts so it isn't leaked
  // (browsers cap concurrent contexts).
  useEffect(() => {
    return () => {
      void ctxRef.current?.close();
      ctxRef.current = null;
    };
  }, []);

  const getCtx = useCallback((): AudioContext | null => {
    if (muted) return null;
    if (!ctxRef.current) {
      try {
        ctxRef.current = new AudioContext();
      } catch {
        return null;
      }
    }
    // resume() returns a promise that can reject if called outside a user
    // gesture; handle it so it never surfaces as an unhandled rejection.
    if (ctxRef.current.state === 'suspended') {
      void ctxRef.current.resume().catch(() => {});
    }
    return ctxRef.current;
  }, [muted]);

  // Warm up (create + resume) the AudioContext the moment the user unmutes.
  // Unmuting is itself a user gesture, so resume() succeeds here and the
  // context is running before the first playXxx() call — otherwise that first
  // sound can fire against a still-suspended context and be silent under
  // strict autoplay policies.
  useEffect(() => {
    if (muted) return;
    getCtx();
  }, [muted, getCtx]);

  const tone = useCallback(
    (freq: number, duration: number, type: OscillatorType = 'sine', volume = 0.15) => {
      const ctx = getCtx();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + duration);
    },
    [getCtx],
  );

  /** Short click/tap — piece moved, card flipped, button pressed */
  const playMove = useCallback(() => {
    tone(600, 0.06, 'square', 0.08);
  }, [tone]);

  /** Positive ding — scored a point, matched, correct answer */
  const playScore = useCallback(() => {
    tone(880, 0.12, 'sine', 0.15);
    setTimeout(() => tone(1100, 0.15, 'sine', 0.12), 60);
  }, [tone]);

  /** Negative buzz — wrong answer, hit obstacle, lost life */
  const playError = useCallback(() => {
    tone(200, 0.2, 'sawtooth', 0.1);
  }, [tone]);

  /** Game over — descending tones */
  const playGameOver = useCallback(() => {
    tone(440, 0.15, 'sine', 0.12);
    setTimeout(() => tone(350, 0.15, 'sine', 0.1), 100);
    setTimeout(() => tone(260, 0.3, 'sine', 0.08), 200);
  }, [tone]);

  /** Level up / achievement — ascending arpeggio */
  const playLevelUp = useCallback(() => {
    tone(523, 0.1, 'sine', 0.12);
    setTimeout(() => tone(659, 0.1, 'sine', 0.12), 80);
    setTimeout(() => tone(784, 0.1, 'sine', 0.12), 160);
    setTimeout(() => tone(1047, 0.2, 'sine', 0.15), 240);
  }, [tone]);

  /** Hard drop / thud — Tetris block landing, bowling throw */
  const playDrop = useCallback(() => {
    tone(150, 0.12, 'triangle', 0.2);
  }, [tone]);

  /** Line clear / combo — satisfying sweep */
  const playClear = useCallback(() => {
    tone(700, 0.08, 'sine', 0.1);
    setTimeout(() => tone(900, 0.08, 'sine', 0.1), 50);
    setTimeout(() => tone(1200, 0.12, 'sine', 0.12), 100);
  }, [tone]);

  /** Countdown tick — timer warning */
  const playTick = useCallback(() => {
    tone(1000, 0.03, 'square', 0.06);
  }, [tone]);

  return {
    playMove,
    playScore,
    playError,
    playGameOver,
    playLevelUp,
    playDrop,
    playClear,
    playTick,
  };
}
