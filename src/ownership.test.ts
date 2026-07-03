import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getConfig } from "./config";
import { ownsGame } from "./ownership";

const games = getConfig("games");

const REGISTRY_URL = "https://raw.githubusercontent.com/freegamestore-online/freegamestore/main/registry.json";

function registry(items: unknown[]) {
  return { ok: true, json: () => Promise.resolve({ games: items }) };
}

let originalFetch: typeof fetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("ownsGame — registry-primary ownership", () => {
  it("owns when creatorGithub matches (case-insensitive), no GitHub API call", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === REGISTRY_URL) return registry([{ id: "snake", name: "Snake", creatorGithub: "Serge-The-Dev" }]);
      throw new Error(`unexpected fetch: ${url}`);
    });
    globalThis.fetch = fetchMock as any;

    const res = await ownsGame(games, "tok", "snake", "serge-the-dev");
    expect(res.owns).toBe(true);
    expect(res.game?.name).toBe("Snake");
    // Only the registry was fetched — no /orgs or /collaborators calls.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not own when creatorGithub differs and not an org member", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === REGISTRY_URL) return registry([{ id: "snake", creatorGithub: "someone-else" }]);
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
      if (url === REGISTRY_URL) return registry([{ id: "snake", creatorGithub: "someone-else" }]);
      if (url.includes("/orgs/") && url.includes("/members/")) return { status: 204 } as any;
      throw new Error(`unexpected fetch: ${url}`);
    });
    globalThis.fetch = fetchMock as any;

    const res = await ownsGame(games, "tok", "snake", "an-org-admin");
    expect(res.owns).toBe(true);
  });

  it("owns a legacy (no creatorGithub) game via accepted collaboration", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === REGISTRY_URL) return registry([{ id: "oldie" }]);
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
      if (url === REGISTRY_URL) return registry([{ id: "other" }]);
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
