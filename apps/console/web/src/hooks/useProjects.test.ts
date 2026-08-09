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

  it("RACE FIX (#4): a picker switch during an in-flight openGame keeps currentId on the switched-to game", async () => {
    // Reproduce: openGame(ocean-save2) starts (slow import); before it resolves,
    // user switches to beat-star via switchTo. When ocean-save2's import later
    // resolves, setCurrentId must NOT clobber currentId back to ocean-save2.
    //
    // We use a deferred import promise to synchronously interleave switchTo
    // between the openGame call and its import resolution. Because ocean-save2 is
    // already in the local session list, openGame skips the fetchSessions round-
    // trip and goes straight to the import POST — the deferred promise blocks there.
    sessionsResponse = { sessions: [srv("sess-bs", "Beat Star", "beat-star"), srv("sess-os", "Ocean Save 2", "ocean-save2")] };

    let resolveImport!: (r: Response) => void;
    const deferredImport = new Promise<Response>((res) => { resolveImport = res; });
    importResponse = () => deferredImport;

    const { result } = await mounted();

    // Start opening ocean-save2 (import is blocked by the deferred promise).
    let openGamePromise!: Promise<string>;
    act(() => {
      openGamePromise = result.current.openGame("ocean-save2");
    });

    // While import is in flight, user switches to beat-star via the picker.
    // switchTo calls setCurrentId which bumps openTokenRef.current.
    act(() => result.current.switchTo("sess-bs"));
    expect(result.current.currentId).toBe("sess-bs");

    // Now resolve the stale ocean-save2 import. The token has advanced, so
    // setCurrentId must NOT be called — currentId must remain beat-star.
    // openGame still resolves (returns the id) rather than throws, because the
    // token guard only suppresses the setCurrentId call, not the import itself.
    await act(async () => {
      resolveImport({ ok: true, status: 200, json: () => Promise.resolve({ name: "Ocean Save 2", appUrl: "https://ocean-save2.freegamestore.online" }) } as Response);
      await openGamePromise; // resolves to sess-os without clobbering currentId
    });

    // currentId must remain on beat-star, not regress to ocean-save2.
    expect(result.current.currentId).toBe("sess-bs");
  });

  it("RACE FIX (#4): a normal unraced openGame still switches to the opened game", async () => {
    // Control: no race. openGame should still switch currentId when there is no
    // intervening switchTo / setCurrentId call.
    sessionsResponse = { sessions: [] };
    importResponse = () => jsonRes({ name: "New Game", appUrl: "https://new-game.freegamestore.online" });
    const { result } = await mounted();

    let openedId = "";
    await act(async () => {
      openedId = await result.current.openGame("new-game");
    });

    expect(result.current.currentId).toBe(openedId);
    const p = result.current.projects.find((x) => x.id === openedId);
    expect(p?.appId).toBe("new-game");
  });
});
