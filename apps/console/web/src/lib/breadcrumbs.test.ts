import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  addBreadcrumb,
  getBreadcrumbs,
  serializeBreadcrumbs,
  _resetBuffer,
} from "./breadcrumbs";

// The breadcrumb buffer is module-level state; reset it before each test.
beforeEach(() => _resetBuffer());

// ---- ring buffer ----

describe("breadcrumbs ring buffer", () => {
  it("stores breadcrumbs in insertion order", () => {
    addBreadcrumb("route", "/");
    addBreadcrumb("game_open", "chess");
    const crumbs = getBreadcrumbs();
    expect(crumbs).toHaveLength(2);
    expect(crumbs[0]!.kind).toBe("route");
    expect(crumbs[1]!.kind).toBe("game_open");
    expect(crumbs[1]!.detail).toBe("chess");
  });

  it("evicts the oldest entry when the buffer is full (capacity = 20)", () => {
    for (let i = 0; i < 20; i++) addBreadcrumb("route", `/page-${i}`);
    expect(getBreadcrumbs()).toHaveLength(20);
    expect(getBreadcrumbs()[0]!.detail).toBe("/page-0");

    // One more — /page-0 should be evicted.
    addBreadcrumb("route", "/page-20");
    const crumbs = getBreadcrumbs();
    expect(crumbs).toHaveLength(20);
    expect(crumbs[0]!.detail).toBe("/page-1");
    expect(crumbs[19]!.detail).toBe("/page-20");
  });

  it("getBreadcrumbs returns a copy — mutation does not affect the buffer", () => {
    addBreadcrumb("route", "/");
    const snapshot = getBreadcrumbs();
    snapshot.push({ t: 0, kind: "route", detail: "/injected" });
    expect(getBreadcrumbs()).toHaveLength(1);
  });

  it("each breadcrumb carries a numeric timestamp", () => {
    const before = Date.now();
    addBreadcrumb("deploy", "sess-1");
    const after = Date.now();
    const crumb = getBreadcrumbs()[0]!;
    expect(crumb.t).toBeGreaterThanOrEqual(before);
    expect(crumb.t).toBeLessThanOrEqual(after);
  });
});

// ---- serialisation ----

describe("serializeBreadcrumbs", () => {
  it("returns an empty string when there are no breadcrumbs", () => {
    expect(serializeBreadcrumbs()).toBe("");
  });

  it("encodes entries as t,kind,detail separated by |", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    addBreadcrumb("route", "/create");
    vi.setSystemTime(2_000_000);
    addBreadcrumb("game_open", "tetris");
    const out = serializeBreadcrumbs(9999);
    const parts = out.split("|");
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe("1000000,route,/create");
    expect(parts[1]).toBe("2000000,game_open,tetris");
    vi.useRealTimers();
  });

  it("truncates from oldest when serialised string exceeds maxLen", () => {
    // Add 20 entries with moderately long detail strings.
    for (let i = 0; i < 20; i++) addBreadcrumb("route", `/this-is-a-fairly-long-route-name-${i}`);
    // Cap at 100 chars — must drop oldest to fit.
    const out = serializeBreadcrumbs(100);
    expect(out.length).toBeLessThanOrEqual(100);
    // The most-recent entry must be preserved.
    expect(out).toContain("/this-is-a-fairly-long-route-name-19");
  });

  it("respects the default 900-char cap", () => {
    for (let i = 0; i < 20; i++) addBreadcrumb("route", `/page-${i}`);
    expect(serializeBreadcrumbs(900).length).toBeLessThanOrEqual(900);
  });
});

// ---- reportError integration ----

describe("reportError includes trimmed breadcrumbs in context", () => {
  let fetchCalls: RequestInit[] = [];

  beforeEach(() => {
    fetchCalls = [];
    globalThis.fetch = vi.fn((_url: unknown, init?: RequestInit) => {
      if (init) fetchCalls.push(init);
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;

    Object.defineProperty(globalThis, "location", {
      value: { pathname: "/create" },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("appends crumbs: prefix when there are breadcrumbs", async () => {
    // Import after mocking fetch so the module picks up the mock.
    const { reportError } = await import("./errorReporter");

    addBreadcrumb("route", "/create");
    addBreadcrumb("game_open", "snake");

    reportError({ message: "test error", context: "window.onerror" });

    expect(fetchCalls).toHaveLength(1);
    const sent = JSON.parse(fetchCalls[0]!.body as string) as { context?: string };
    expect(sent.context).toContain("crumbs:");
    expect(sent.context).toContain("/create");
    expect(sent.context).toContain("snake");
    // Must respect the 950-char cap applied in errorReporter.
    expect((sent.context ?? "").length).toBeLessThanOrEqual(950);
  });

  it("does not include crumbs: prefix when the buffer is empty", async () => {
    const { reportError } = await import("./errorReporter");

    // Buffer was reset in beforeEach; send error immediately.
    reportError({ message: "no crumbs yet — unique msg 9a3f" });

    expect(fetchCalls).toHaveLength(1);
    const sent = JSON.parse(fetchCalls[0]!.body as string) as { context?: string };
    // context may be undefined or a string without "crumbs:".
    expect(sent.context ?? "").not.toContain("crumbs:");
  });
});
