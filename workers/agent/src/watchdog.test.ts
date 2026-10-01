import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { armWatchdog, createTurnFence, lockIsStale } from "./watchdog";

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

describe("createTurnFence — a superseded turn cannot write (#82)", () => {
  it("runs guarded writes only while the turn's epoch is current", () => {
    let current = 1;
    const fence = createTurnFence(1, () => current);
    const write = vi.fn();
    const guarded = fence.guard(write);

    guarded("first");
    expect(fence.isCurrent()).toBe(true);
    expect(write).toHaveBeenCalledWith("first");

    // The alarm fences the slow turn off and starts a replacement (epoch 2).
    current = 2;
    guarded("stale checkpoint");
    expect(fence.isCurrent()).toBe(false);
    expect(write).toHaveBeenCalledTimes(1);

    // The replacement's own fence is unaffected.
    const replacement = vi.fn();
    createTurnFence(2, () => current).guard(replacement)("fresh");
    expect(replacement).toHaveBeenCalledWith("fresh");
  });
});
