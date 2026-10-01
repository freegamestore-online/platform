import { beforeEach, describe, expect, it, vi } from "vitest";

// #83: /import and /reset checked the turn lock but never took it, then awaited
// GitHub for seconds. A /chat arriving in that window claimed the lock and its
// turn later checkpointed stale files/messages over the import or reset. They
// must hold the lock for their whole duration so a concurrent /chat is refused.

const h = vi.hoisted(() => {
  function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }
  return { deferred, ownsGate: null as null | Promise<unknown>, seedGate: null as null | Promise<unknown> };
});

vi.mock("./ownership", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ownership")>()),
  ownsGame: vi.fn(async () => {
    await h.ownsGate;
    return { owns: true, game: { id: "beat-star2", name: "Beat Star 2" } };
  }),
}));
vi.mock("./deploy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./deploy")>()),
  fetchRepoHeadSha: vi.fn(async () => "headsha"),
  fetchRepoFiles: vi.fn(async () => new Map([["web/src/App.tsx", "imported game"]])),
  fetchTemplateSeed: vi.fn(async () => {
    await h.seedGate;
    return null;
  }),
  resolveSeedFiles: vi.fn(() => ({ "web/src/App.tsx": "fresh template" })),
}));

import { AgentSession } from "./session";

const doEnv = { STORE: "games" } as unknown as ConstructorParameters<typeof AgentSession>[1];
const AUTH = { "X-Auth-User": "u1", "X-Auth-Login": "alice" };

function mockState(initial: Record<string, unknown>) {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
    store,
    state: {
      storage: {
        get: async (k: string) => store.get(k),
        put: async (k: string, v: unknown) => void store.set(k, v),
        delete: async (k: string) => void store.delete(k),
        setAlarm: async () => {},
        deleteAlarm: async () => {},
      },
    } as unknown as DurableObjectState,
  };
}

const post = (path: string, body: unknown) =>
  new Request(`https://do${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...AUTH },
    body: JSON.stringify(body),
  });

const chat = () => post("/chat", { message: "make it red", aiConfig: { provider: "anthropic", model: "m" } });

const isLocked = (s: AgentSession) => (s as unknown as { chatInProgress: boolean }).chatInProgress;

beforeEach(() => {
  h.ownsGate = null;
  h.seedGate = null;
});

describe("/import and /reset hold the turn lock (#83)", () => {
  it("refuses a /chat that arrives while /import is awaiting GitHub, and keeps the import", async () => {
    const gate = h.deferred<void>();
    h.ownsGate = gate.promise;
    const { state, store } = mockState({
      owner: "u1",
      session: { messages: [], files: { "web/src/App.tsx": "scaffold" }, tokenUsage: { input: 0, output: 0 } },
    });
    const s = new AgentSession(state, doEnv);

    const importing = s.fetch(post("/import", { id: "beat-star2" }));
    await vi.waitFor(() => expect(isLocked(s)).toBe(true));

    const concurrent = await s.fetch(chat());
    expect(concurrent.status).toBe(429);
    expect(((await concurrent.json()) as { error: string }).error).toMatch(/in progress/i);

    gate.resolve();
    expect((await importing).status).toBe(200);
    const saved = store.get("session") as { appId: string; files: Record<string, string>; importedSha: string };
    expect(saved.appId).toBe("beat-star2");
    expect(saved.files["web/src/App.tsx"]).toBe("imported game");
    expect(saved.importedSha).toBe("headsha");
    expect(isLocked(s)).toBe(false); // released for the next request
  });

  it("releases the lock when /import fails partway", async () => {
    const { state } = mockState({ owner: "u1", session: { appId: "other-game", messages: [], files: {} } });
    const s = new AgentSession(state, doEnv);
    expect((await s.fetch(post("/import", { id: "beat-star2" }))).status).toBe(409);
    expect(isLocked(s)).toBe(false);
  });

  it("refuses a /chat that arrives while /reset is re-seeding, and keeps the reset", async () => {
    const gate = h.deferred<void>();
    h.seedGate = gate.promise;
    const { state, store } = mockState({
      owner: "u1",
      session: {
        messages: [{ role: "user", content: "old chat" }],
        files: { "web/src/App.tsx": "old game" },
        tokenUsage: { input: 5, output: 5 },
      },
    });
    const s = new AgentSession(state, doEnv);

    const resetting = s.fetch(post("/reset", {}));
    await vi.waitFor(() => expect(isLocked(s)).toBe(true));

    expect((await s.fetch(chat())).status).toBe(429);

    gate.resolve();
    expect((await resetting).status).toBe(200);
    const saved = store.get("session") as { messages: unknown[]; files: Record<string, string> };
    expect(saved.messages).toEqual([]);
    expect(saved.files["web/src/App.tsx"]).toBe("fresh template");
    expect(isLocked(s)).toBe(false);
  });

  it("still refuses /import and /reset while a real turn holds the lock", async () => {
    const { state } = mockState({ owner: "u1", session: { messages: [], files: {} } });
    const s = new AgentSession(state, doEnv);
    const internals = s as unknown as { chatInProgress: boolean; lastTurnEventAt: number };
    internals.chatInProgress = true;
    internals.lastTurnEventAt = Date.now(); // live turn, not stale
    expect((await s.fetch(post("/import", { id: "beat-star2" }))).status).toBe(409);
    expect((await s.fetch(post("/reset", {}))).status).toBe(409);
    expect(internals.chatInProgress).toBe(true); // a refused request must not release the turn's lock
  });
});
