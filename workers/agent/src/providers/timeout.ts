/** Idle-timeout guard for streaming provider calls.
 *
 * A provider fetch with no timeout can hang forever (upstream never sends
 * headers, or stalls mid-stream). That wedges the whole turn: the SSE stream
 * never completes, so `chatInProgress` stays set and every later /chat 429s
 * (and /import & /reset 409) until the DO is evicted.
 *
 * We use an IDLE timeout rather than a total one: the timer is reset on every
 * chunk received, so a legitimately long generation that keeps streaming tokens
 * is never cut off, but a truly stalled upstream (no bytes for `idleMs`) aborts.
 * The same controller also bounds the initial connect (the timer is armed before
 * the fetch and only reset once bytes start flowing).
 */

export const PROVIDER_IDLE_TIMEOUT_MS = 90_000;

export interface StreamTimeout {
  signal: AbortSignal;
  /** Call on each received chunk to reset the idle clock. */
  reset: () => void;
  /** Call when the stream is fully consumed (or errors) to stop the timer. */
  clear: () => void;
}

export function createStreamTimeout(idleMs: number = PROVIDER_IDLE_TIMEOUT_MS): StreamTimeout {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const reset = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => ctrl.abort(), idleMs);
  };
  reset();
  return {
    signal: ctrl.signal,
    reset,
    clear: () => {
      if (timer) clearTimeout(timer);
    },
  };
}
