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
  // Set once the game unmounts: no new AudioContext may be created after that.
  const disposedRef = useRef(false);
  // Delayed notes of multi-tone sounds (score, game over, level up, …).
  const timersRef = useRef(new Set<ReturnType<typeof setTimeout>>());

  // Release the AudioContext when the game unmounts so it isn't leaked
  // (browsers cap concurrent contexts). Pending delayed notes are cancelled
  // first: one firing after unmount used to create a NEW context that nothing
  // ever closed — one leak per game swapped out mid-sound, until browsers stop
  // allowing new contexts and sound dies (#99). Reset on (re)mount so
  // StrictMode's simulated remount doesn't leave sounds permanently disabled.
  useEffect(() => {
    disposedRef.current = false;
    const timers = timersRef.current;
    return () => {
      disposedRef.current = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      void ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
    };
  }, []);

  const getCtx = useCallback((): AudioContext | null => {
    if (muted || disposedRef.current) return null;
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

  /** Play a note after `ms`, cancelled if the game unmounts first. */
  const later = useCallback(
    (ms: number, ...args: Parameters<typeof tone>) => {
      const timer = setTimeout(() => {
        timersRef.current.delete(timer);
        tone(...args);
      }, ms);
      timersRef.current.add(timer);
    },
    [tone],
  );

  /** Short click/tap — piece moved, card flipped, button pressed */
  const playMove = useCallback(() => {
    tone(600, 0.06, 'square', 0.08);
  }, [tone]);

  /** Positive ding — scored a point, matched, correct answer */
  const playScore = useCallback(() => {
    tone(880, 0.12, 'sine', 0.15);
    later(60, 1100, 0.15, 'sine', 0.12);
  }, [tone, later]);

  /** Negative buzz — wrong answer, hit obstacle, lost life */
  const playError = useCallback(() => {
    tone(200, 0.2, 'sawtooth', 0.1);
  }, [tone]);

  /** Game over — descending tones */
  const playGameOver = useCallback(() => {
    tone(440, 0.15, 'sine', 0.12);
    later(100, 350, 0.15, 'sine', 0.1);
    later(200, 260, 0.3, 'sine', 0.08);
  }, [tone, later]);

  /** Level up / achievement — ascending arpeggio */
  const playLevelUp = useCallback(() => {
    tone(523, 0.1, 'sine', 0.12);
    later(80, 659, 0.1, 'sine', 0.12);
    later(160, 784, 0.1, 'sine', 0.12);
    later(240, 1047, 0.2, 'sine', 0.15);
  }, [tone, later]);

  /** Hard drop / thud — Tetris block landing, bowling throw */
  const playDrop = useCallback(() => {
    tone(150, 0.12, 'triangle', 0.2);
  }, [tone]);

  /** Line clear / combo — satisfying sweep */
  const playClear = useCallback(() => {
    tone(700, 0.08, 'sine', 0.1);
    later(50, 900, 0.08, 'sine', 0.1);
    later(100, 1200, 0.12, 'sine', 0.12);
  }, [tone, later]);

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
