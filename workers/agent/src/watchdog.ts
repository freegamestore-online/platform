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
