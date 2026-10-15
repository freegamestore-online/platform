import { useMemo } from 'react';
import { vibrate, type VibrationPattern } from './haptics.js';

export interface Haptics {
  /** Vibrate with a pattern. Silent when haptics are off or unsupported. */
  pulse(pattern: VibrationPattern): void;
}

/**
 * Haptic pulses for a game. Haptics are not visual motion, so reduced motion does
 * not switch them off. Pass `enabled: false` to mute them, for example from a
 * settings toggle. The returned object is stable while `enabled` is unchanged.
 */
export function useHaptics(enabled = true): Haptics {
  return useMemo(
    () => ({
      pulse(pattern) {
        if (enabled) vibrate(pattern);
      },
    }),
    [enabled],
  );
}
