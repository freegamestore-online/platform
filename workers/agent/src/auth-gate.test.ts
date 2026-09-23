import { describe, expect, it } from "vitest";
import worker from "./index";
import { AgentSession } from "./session";

// Regression guards for the /session/* auth + per-session ownership fix.
// Before it, any caller who knew a session id could read another user's
// transcript, wipe it, or drive the agent.

const env = { STORE: "games" } as unknown as Parameters<typeof worker.fetch>[1];

describe("agent worker /session auth gate", () => {
  it("401s a /session request that carries no session token", async () => {
    const res = await worker.fetch(new Request("https://agent.freegamestore.online/session/abc/status"), env);
    expect(res.status).toBe(401);
  });
});

// Minimal in-memory DurableObjectState stub (only storage.get/put are used).
function mockState() {
  const store = new Map<string, unknown>();
  return {
    storage: {
      get: async (k: string) => store.get(k),
      put: async (k: string, v: unknown) => {
        store.set(k, v);
      },
    },
  } as unknown as DurableObjectState;
}

describe("AgentSession ownership gate", () => {
  const doEnv = { STORE: "games" } as unknown as ConstructorParameters<typeof AgentSession>[1];

  it("401s when the worker set no verified X-Auth-User", async () => {
    const s = new AgentSession(mockState(), doEnv);
    const res = await s.fetch(new Request("https://do/status"));
    expect(res.status).toBe(401);
  });

  it("binds the session to its first caller (TOFU) and 403s everyone else", async () => {
    const s = new AgentSession(mockState(), doEnv);
    // Unknown path returns 404 *after* the gate runs — lets us exercise the
    // ownership logic without pulling in the full chat/status handlers.
    const first = await s.fetch(new Request("https://do/nope", { headers: { "X-Auth-User": "alice" } }));
    expect(first.status).toBe(404); // gate passed; alice now owns the session

    const other = await s.fetch(new Request("https://do/nope", { headers: { "X-Auth-User": "bob" } }));
    expect(other.status).toBe(403); // different user rejected

    const ownerAgain = await s.fetch(new Request("https://do/nope", { headers: { "X-Auth-User": "alice" } }));
    expect(ownerAgain.status).toBe(404); // owner still allowed past the gate
  });
});
