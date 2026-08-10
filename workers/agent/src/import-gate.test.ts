import { beforeEach, describe, expect, it, vi } from "vitest";
import { ownsGame } from "./ownership";
import { AgentSession } from "./session";

// Regression guard for the game-open (import) contract the console relies on.
// The console's openGame() surfaces these statuses to the user; if a build ever
// silently changes them, "open this game" breaks in ways the client can't
// distinguish. ownsGame() is mocked so we exercise the handler's own gate
// without hitting GitHub / the registry.
vi.mock("./ownership", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ownership")>()),
  ownsGame: vi.fn(),
}));

const owns = vi.mocked(ownsGame);
const doEnv = { STORE: "games" } as unknown as ConstructorParameters<typeof AgentSession>[1];

// Minimal in-memory DurableObjectState (get/put only), with optional seed so a
// test can pre-bind the session without triggering load()'s ~25-call seed.
function mockState(initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
    storage: {
      get: async (k: string) => store.get(k),
      put: async (k: string, v: unknown) => {
        store.set(k, v);
      },
    },
  } as unknown as DurableObjectState;
}

function importReq(body: unknown, headers: Record<string, string>) {
  return new Request("https://do/import", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const AUTH = { "X-Auth-User": "u1", "X-Auth-Login": "alice" };

beforeEach(() => owns.mockReset());

describe("AgentSession /import gate", () => {
  it("401s an unauthenticated caller", async () => {
    const s = new AgentSession(mockState(), doEnv);
    const res = await s.fetch(importReq({ id: "beat-star2" }, {}));
    expect(res.status).toBe(401);
  });

  it("400s a malformed game id", async () => {
    const s = new AgentSession(mockState(), doEnv);
    const res = await s.fetch(importReq({ id: "Bad Slug!" }, AUTH));
    expect(res.status).toBe(400);
  });

  it("403s when the caller's GitHub login is unavailable", async () => {
    const s = new AgentSession(mockState(), doEnv);
    const res = await s.fetch(importReq({ id: "beat-star2" }, { "X-Auth-User": "u1" }));
    expect(res.status).toBe(403);
  });

  it("409s when the session is already bound to a different game", async () => {
    const s = new AgentSession(mockState({ session: { appId: "other-game" } }), doEnv);
    const res = await s.fetch(importReq({ id: "beat-star2" }, AUTH));
    expect(res.status).toBe(409);
  });

  it("404s when the game is not in the registry", async () => {
    owns.mockResolvedValue({ owns: false, game: null });
    const s = new AgentSession(mockState({ session: {} }), doEnv);
    const res = await s.fetch(importReq({ id: "beat-star2" }, AUTH));
    expect(res.status).toBe(404);
  });

  it("403s when the caller does not own the game", async () => {
    owns.mockResolvedValue({
      owns: false,
      game: { id: "beat-star2" } as unknown as Awaited<ReturnType<typeof ownsGame>>["game"],
    });
    const s = new AgentSession(mockState({ session: {} }), doEnv);
    const res = await s.fetch(importReq({ id: "beat-star2" }, AUTH));
    expect(res.status).toBe(403);
  });
});
