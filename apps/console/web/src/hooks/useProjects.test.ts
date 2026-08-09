import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

// useProjects only needs { user, loading } from useAuth — stub a signed-in user.
vi.mock("./useAuth", () => ({
  useAuth: () => ({ user: { sub: "github:1" }, loading: false }),
}));

import { useProjects } from "./useProjects";

function jsonRes(body: unknown, ok = true, status = 200): Promise<Response> {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(body) } as Response);
}

function srv(id: string, name: string, gameId?: string) {
  return {
    id,
    name,
    gameId,
    gameUrl: gameId ? `https://${gameId}.freegamestore.online` : undefined,
    deployed: !!gameId,
    createdAt: new Date(0).toISOString(),
  };
}

// Per-test knobs for the two endpoints the hook hits.
let sessionsResponse: { sessions: ReturnType<typeof srv>[] };
let importResponse: () => Promise<Response>;

beforeEach(() => {
  localStorage.clear();
  sessionsResponse = { sessions: [] };
  importResponse = () => jsonRes({ name: "Imported", appUrl: "https://imported.freegamestore.online" });

  globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method || "GET").toUpperCase();
    if (url.endsWith("/sessions") && method === "GET") return jsonRes(sessionsResponse);
    if (url.includes("/import") && method === "POST") return importResponse();
    if (url.includes("/sessions/") && (method === "PUT" || method === "DELETE")) return jsonRes({ ok: true });
    return jsonRes({}, false, 404);
  }) as unknown as typeof fetch;
});

afterEach(() => vi.restoreAllMocks());

async function mounted() {
  const hook = renderHook(() => useProjects());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

describe("useProjects — initial load", () => {
  it("lists server sessions but does NOT auto-open one (explicit-open)", async () => {
    // Silent auto-open once dropped users into a live game's session; opening a
    // game is now a deliberate act. No stored id → land on the empty state.
    sessionsResponse = { sessions: [srv("sess-a", "Game A", "game-a")] };
    const { result } = await mounted();
    expect(result.current.projects.map((p) => p.id)).toEqual(["sess-a"]);
    expect(result.current.currentId).toBeNull();
  });
});

describe("useProjects — switchTo", () => {
  it("sets currentId and adds a placeholder for an id not yet in the list", async () => {
    const { result } = await mounted();
    act(() => result.current.switchTo("sess-x"));
    expect(result.current.currentId).toBe("sess-x");
    expect(result.current.projects.some((p) => p.id === "sess-x")).toBe(true);
  });
});

describe("useProjects — openGame", () => {
  it("binds a fresh session to the game and opens it", async () => {
    importResponse = () => jsonRes({ name: "Beat Star 2", appUrl: "https://beat-star2.freegamestore.online" });
    const { result } = await mounted();
    let id = "";
    await act(async () => {
      id = await result.current.openGame("beat-star2");
    });
    expect(result.current.currentId).toBe(id);
    const p = result.current.projects.find((x) => x.id === id);
    expect(p?.appId).toBe("beat-star2");
    expect(p?.deployed).toBe(true);
  });

  it("REUSES the existing session for a game — one game ↔ one session", async () => {
    // The invariant the picker + switch rely on: opening an already-bound game
    // must not mint a duplicate session/row.
    sessionsResponse = { sessions: [srv("sess-bs", "Beat Star", "beat-star")] };
    importResponse = () => jsonRes({ name: "Beat Star", appUrl: "https://beat-star.freegamestore.online" });
    const { result } = await mounted();
    let id = "";
    await act(async () => {
      id = await result.current.openGame("beat-star");
    });
    expect(id).toBe("sess-bs");
    expect(result.current.projects.filter((p) => p.appId === "beat-star")).toHaveLength(1);
  });

  it("REGRESSION: a failed import rejects and leaves the previously-open game intact", async () => {
    // This is the reported bug's blast radius: opening beat-star2 (My Games →
    // /create/beat-star2) 404s server-side. openGame MUST reject (so the caller
    // can surface it) and MUST NOT move currentId off the game you were editing.
    sessionsResponse = { sessions: [srv("sess-a", "Game A", "game-a")] };
    importResponse = () => jsonRes({ error: 'game "beat-star2" not found' }, false, 404);
    const { result } = await mounted();
    act(() => result.current.switchTo("sess-a"));
    expect(result.current.currentId).toBe("sess-a");

    await expect(
      act(async () => {
        await result.current.openGame("beat-star2");
      }),
    ).rejects.toThrow(/beat-star2|not found/);

    expect(result.current.currentId).toBe("sess-a");
    expect(result.current.projects.some((p) => p.appId === "beat-star2")).toBe(false);
  });
});
