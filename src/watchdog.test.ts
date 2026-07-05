import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { armWatchdog } from "./watchdog";

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
