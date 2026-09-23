import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getConfig } from "./config";
import { OwnershipLookupError, ownsGame } from "./ownership";

const games = getConfig("games");

// The authenticated (uncached) contents API is now the PRIMARY registry read;
// raw.githubusercontent.com is only the fallback.
const CONTENTS_URL = "https://api.github.com/repos/freegamestore-online/freegamestore/contents/registry.json";
const REGISTRY_URL = "https://raw.githubusercontent.com/freegamestore-online/freegamestore/main/registry.json";

function registry(items: unknown[]) {
  return { ok: true, status: 200, json: () => Promise.resolve({ games: items }) };
}

let originalFetch: typeof fetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("ownsGame — registry-primary ownership", () => {
  it("owns when creatorGithub matches (case-insensitive), reading the uncached contents API", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      // Fresh read: the authenticated contents API answers, so we never touch
      // the CDN-cached raw URL (the staleness bug this fix closes).
      if (url === CONTENTS_URL) return registry([{ id: "snake", name: "Snake", creatorGithub: "Serge-The-Dev" }]);
      throw new Error(`unexpected fetch: ${url}`);
    });
    globalThis.fetch = fetchMock as any;

    const res = await ownsGame(games, "tok", "snake", "serge-the-dev");
    expect(res.owns).toBe(true);
    expect(res.game?.name).toBe("Snake");
    // Only the contents API was fetched — no raw CDN, no /orgs or /collaborators.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(CONTENTS_URL);
  });

  it("reads a just-provisioned game from the uncached contents API (fresh-read path)", async () => {
    // The CDN still serves a STALE registry that predates the new game; the
    // contents API has it. The fresh read must win.
    const fetchMock = vi.fn(async (url: string) => {
      if (url === CONTENTS_URL) return registry([{ id: "brand-new", name: "Brand New", creatorGithub: "creator" }]);
      if (url === REGISTRY_URL) return registry([]); // stale CDN — no new game
      throw new Error(`unexpected fetch: ${url}`);
    });
    globalThis.fetch = fetchMock as any;

    const res = await ownsGame(games, "tok", "brand-new", "creator");
    expect(res.owns).toBe(true);
    expect(res.game?.name).toBe("Brand New");
    // The stale raw URL was never consulted.
    expect(fetchMock.mock.calls.every((c) => c[0] !== REGISTRY_URL)).toBe(true);
  });

  it("falls back to the raw CDN URL when the contents API fails", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      // 404 is non-retryable, so resilientFetch returns it immediately (no backoff).
      if (url === CONTENTS_URL) return { ok: false, status: 404 } as any; // contents API miss
      if (url === REGISTRY_URL) return registry([{ id: "snake", creatorGithub: "creator" }]);
      throw new Error(`unexpected fetch: ${url}`);
    });
    globalThis.fetch = fetchMock as any;

    const res = await ownsGame(games, "tok", "snake", "creator");
    expect(res.owns).toBe(true);
    expect(fetchMock.mock.calls.some((c) => c[0] === REGISTRY_URL)).toBe(true);
  });

  it("does not own when creatorGithub differs and not an org member", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === CONTENTS_URL) return registry([{ id: "snake", creatorGithub: "someone-else" }]);
      // org membership check → not a member (404)
      return { status: 404 } as any;
    });
    globalThis.fetch = fetchMock as any;

    const res = await ownsGame(games, "tok", "snake", "serge-the-dev");
    expect(res.owns).toBe(false);
    expect(res.game).not.toBeNull();
  });

  it("owns as org member even when creatorGithub differs", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === CONTENTS_URL) return registry([{ id: "snake", creatorGithub: "someone-else" }]);
      if (url.includes("/orgs/") && url.includes("/members/")) return { status: 204 } as any;
      throw new Error(`unexpected fetch: ${url}`);
    });
    globalThis.fetch = fetchMock as any;

    const res = await ownsGame(games, "tok", "snake", "an-org-admin");
    expect(res.owns).toBe(true);
  });

  it("owns a legacy (no creatorGithub) game via accepted collaboration", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === CONTENTS_URL) return registry([{ id: "oldie" }]);
      if (url.includes("/orgs/") && url.includes("/members/")) return { status: 404 } as any;
      if (url.includes("/collaborators/")) return { status: 204 } as any;
      throw new Error(`unexpected fetch: ${url}`);
    });
    globalThis.fetch = fetchMock as any;

    const res = await ownsGame(games, "tok", "oldie", "legacy-owner");
    expect(res.owns).toBe(true);
  });

  it("returns game=null and owns=false when the game is not in the registry", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === CONTENTS_URL) return registry([{ id: "other" }]);
      throw new Error(`unexpected fetch: ${url}`);
    });
    globalThis.fetch = fetchMock as any;

    const res = await ownsGame(games, "tok", "missing", "anyone");
    expect(res.owns).toBe(false);
    expect(res.game).toBeNull();
    // No membership/collaborator calls for a non-existent game.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// #40 — an upstream failure must never read as "no such game" / "not yours".
describe("ownsGame — upstream failures surface as errors", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("throws when the contents API 401s and the raw fallback 500s (registry unreadable)", async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url === CONTENTS_URL) return { ok: false, status: 401 } as any;
      if (url === REGISTRY_URL) return { ok: false, status: 500 } as any;
      throw new Error(`unexpected fetch: ${url}`);
    }) as any;

    await expect(ownsGame(games, "tok", "snake", "creator")).rejects.toThrow(OwnershipLookupError);
    await expect(ownsGame(games, "tok", "snake", "creator")).rejects.toThrow(/401.*500/);
  });

  it("throws when both registry reads fail at the network level", async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url === REGISTRY_URL) throw new TypeError("network down");
      return { ok: false, status: 404 } as any;
    }) as any;

    await expect(ownsGame(games, "tok", "snake", "creator")).rejects.toThrow(/registry unavailable.*network down/);
  });

  it("throws when the org-membership probe returns 403 instead of denying ownership", async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url === CONTENTS_URL) return registry([{ id: "snake", creatorGithub: "someone-else" }]);
      if (url.includes("/orgs/") && url.includes("/members/")) return { ok: false, status: 403 } as any;
      throw new Error(`unexpected fetch: ${url}`);
    }) as any;

    await expect(ownsGame(games, "tok", "snake", "intruder")).rejects.toThrow(/org membership check failed \(403\)/);
  });

  it("throws when the collaborator probe keeps returning 503 (after retries)", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url === CONTENTS_URL) return registry([{ id: "oldie" }]);
      if (url.includes("/orgs/") && url.includes("/members/")) return { ok: false, status: 404 } as any;
      if (url.includes("/collaborators/")) return { ok: false, status: 503, headers: new Headers() } as any;
      throw new Error(`unexpected fetch: ${url}`);
    }) as any;

    const pending = ownsGame(games, "tok", "oldie", "legacy-owner");
    const assertion = expect(pending).rejects.toThrow(/collaborator check failed \(503\)/);
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
  });
});
