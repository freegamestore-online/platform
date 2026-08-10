import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { armWatchdog, lockIsStale } from "./watchdog";

describe("lockIsStale — recovery endpoints must be able to break a leaked lock", () => {
  const HUNG = 5 * 60_000; // mirrors HUNG_TURN_MS

  it("is false when the lock is not held (nothing to break)", () => {
    expect(lockIsStale(false, 0, 10 * HUNG, HUNG)).toBe(false);
  });

  it("is false while the turn is actively producing events (protect a live build)", () => {
    const now = 1_000_000;
    expect(lockIsStale(true, now - 1000, now, HUNG)).toBe(false); // 1s of silence
    expect(lockIsStale(true, now - (HUNG - 1), now, HUNG)).toBe(false); // just under threshold
  });

  it("is true once a held lock has been silent for at least HUNG_TURN_MS", () => {
    const now = 1_000_000;
    expect(lockIsStale(true, now - HUNG, now, HUNG)).toBe(true); // exactly at threshold
    expect(lockIsStale(true, now - 10 * HUNG, now, HUNG)).toBe(true);
  });
});

describe("armWatchdog", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires onExpire once after the deadline", () => {
    const cb = vi.fn();
    const w = armWatchdog(1000, cb);
    expect(cb).not.toHaveBeenCalled();
    expect(w.fired()).toBe(false);

    vi.advanceTimersByTime(1000);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(w.fired()).toBe(true);
  });

  it("does not fire if cleared before the deadline", () => {
    const cb = vi.fn();
    const w = armWatchdog(1000, cb);
    vi.advanceTimersByTime(500);
    w.clear();
    vi.advanceTimersByTime(1000);
    expect(cb).not.toHaveBeenCalled();
    expect(w.fired()).toBe(true); // clear() marks it done so the turn's finally can tell
  });

  it("clear() after firing is a no-op (onExpire not called again)", () => {
    const cb = vi.fn();
    const w = armWatchdog(1000, cb);
    vi.advanceTimersByTime(1000);
    w.clear();
    vi.advanceTimersByTime(5000);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
