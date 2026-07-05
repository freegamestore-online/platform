import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeGhApi, mapPool, resilientFetch } from "./ghfetch";

let originalFetch: typeof fetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("resilientFetch — retry on transient failure", () => {
  it("retries a 500 then returns the successful response", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      return { status: calls === 1 ? 500 : 200 } as any;
    }) as any;

    const res = await resilientFetch("https://api.github.com/x", {}, { retries: 3 });
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
  });

  it("does NOT retry an ordinary 404 (callers probe for it)", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      return { status: 404 } as any;
    }) as any;

    const res = await resilientFetch("https://api.github.com/x", {}, { retries: 3 });
    expect(res.status).toBe(404);
    expect(calls).toBe(1);
  });

  it("gives up after the retry budget and returns the last retryable response", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      return { status: 503 } as any;
    }) as any;

    const res = await resilientFetch("https://api.github.com/x", {}, { retries: 1 });
    expect(res.status).toBe(503);
    expect(calls).toBe(2); // initial + 1 retry
  });
});

describe("resilientFetch — timeout", () => {
  it("aborts a hung request and throws a timeout error", async () => {
    globalThis.fetch = vi.fn(
      (_url: string, init: any) =>
        new Promise((_, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    ) as any;

    await expect(resilientFetch("https://api.github.com/x", {}, { timeoutMs: 20, retries: 0 })).rejects.toThrow(/timed out/);
  });
});

describe("makeGhApi", () => {
  const resp = (status: number, bodyText: string) => ({
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    text: async () => bodyText,
  });

  it("returns parsed JSON on 200", async () => {
    globalThis.fetch = vi.fn(async () => resp(200, '{"id":42}')) as any;
    const gh = makeGhApi("tok", "agent", { retries: 0 });
    const data = await gh("/repos/x/y");
    expect(data.id).toBe(42);
  });

  it("throws WITH the body on a persistent 500", async () => {
    globalThis.fetch = vi.fn(async () => resp(500, '{"message":"boom"}')) as any;
    const gh = makeGhApi("tok", "agent", { retries: 0 });
    await expect(gh("/repos/x/y")).rejects.toThrow(/500.*boom/s);
  });

  it("returns the body (no throw) on an ordinary 404 so callers can probe existence", async () => {
    globalThis.fetch = vi.fn(async () => resp(404, '{"message":"Not Found"}')) as any;
    const gh = makeGhApi("tok", "agent", { retries: 0 });
    const data = await gh("/repos/x/y");
    expect(data.message).toBe("Not Found");
  });

  it("treats 204 No Content as an empty object", async () => {
    globalThis.fetch = vi.fn(async () => ({ status: 204, ok: true, headers: { get: () => null } })) as any;
    const gh = makeGhApi("tok", "agent", { retries: 0 });
    expect(await gh("/repos/x/y", "PUT", { permission: "push" })).toEqual({});
  });
});

describe("mapPool", () => {
  it("preserves input order and never exceeds the concurrency limit", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

    const out = await mapPool(items, 3, async (n) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return n * 2;
    });

    expect(out).toEqual(items.map((n) => n * 2));
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(1); // proves it actually parallelized
  });

  it("handles an empty list", async () => {
    expect(await mapPool([], 4, async () => 1)).toEqual([]);
  });
});
