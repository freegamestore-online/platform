/** A one-shot deadline timer.
 *
 * The chat turn runs as a background task whose `finally` clears the
 * `chatInProgress` lock. If that task HANGS (e.g. a provider or GitHub call that
 * never resolves and slips past its own timeout), the finally never runs, the
 * lock stays set, and every later /chat 429s (and /import & /reset 409) until
 * the Durable Object is evicted. This arms an independent timer that force-runs
 * a release callback if the turn overruns a hard deadline.
 *
 * `onExpire` runs at most once, and never after `clear()` — so the normal
 * end-of-turn path (which clears the watchdog) and the deadline path can't both
 * fire.
 */
export interface Watchdog {
  /** Stop the timer. Safe to call multiple times. */
  clear: () => void;
  /** Whether the deadline already fired. */
  fired: () => boolean;
}

/** Whether a held `chatInProgress` lock is STALE — its turn leaked the lock and
 *  no longer counts as running. True when the lock is held AND the turn has
 *  produced no event for at least `hungMs`. A hung provider/GitHub call means
 *  the turn's `finally` (which clears the lock) never runs; if the pending-turn
 *  record is also gone, the resurrection alarm can't fence it either, so every
 *  later /chat 429s and /import & /reset 409 until the DO is evicted. Recovery
 *  endpoints call this to break such a lock instead of rejecting forever. Pure +
 *  exported so the decision is unit-testable (mirrors deadlineStatus). */
export function lockIsStale(chatInProgress: boolean, lastTurnEventAt: number, now: number, hungMs: number): boolean {
  return chatInProgress && now - lastTurnEventAt >= hungMs;
}

/** Fence for a turn's side effects. A turn the alarm declared hung is replaced
 *  by a resumed turn with a newer epoch, but the old one may still be running
 *  (it was only slow). Every write it could make — transcript checkpoints, the
 *  end-of-round save, deploy callbacks, liveness pings — goes through `guard`,
 *  which turns it into a no-op once the turn is no longer current, so a stale
 *  turn can never overwrite the replacement's transcript and files (#82). */
export interface TurnFence {
  isCurrent: () => boolean;
  guard: <A extends unknown[]>(fn: (...args: A) => void) => (...args: A) => void;
}

export function createTurnFence(epoch: number, currentEpoch: () => number): TurnFence {
  const isCurrent = () => currentEpoch() === epoch;
  return {
    isCurrent,
    guard:
      (fn) =>
      (...args) => {
        if (isCurrent()) fn(...args);
      },
  };
}

export function armWatchdog(ms: number, onExpire: () => void): Watchdog {
  let done = false;
  const timer = setTimeout(() => {
    if (done) return;
    done = true;
    onExpire();
  }, ms);
  return {
    clear: () => {
      done = true;
      clearTimeout(timer);
    },
    fired: () => done,
  };
}
