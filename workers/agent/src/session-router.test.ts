import { describe, expect, it, vi } from "vitest";
import { routeSessionRequest, type SessionRouteHandlers } from "./session-router";

function setup() {
  const rows = new Map<string, unknown>();
  const handlers: SessionRouteHandlers = {
    chat: vi.fn(async () => new Response("chat")),
    status: vi.fn(async () => new Response("status")),
    files: vi.fn(async () => new Response("files")),
    history: vi.fn(async () => new Response("history")),
    errors: vi.fn(async () => new Response("errors")),
    import: vi.fn(async () => new Response("import")),
    reset: vi.fn(async () => new Response("reset")),
    pushSubscribe: vi.fn(async () => new Response("push")),
  };
  return {
    rows,
    handlers,
    deps: {
      storage: { get: async (key: string) => rows.get(key), put: async (key: string, value: unknown) => void rows.set(key, value) },
      config: { domain: "freegamestore.online" },
      handlers,
    },
  };
}

describe("routeSessionRequest", () => {
  it("preserves TOFU authorization before dispatching a route", async () => {
    const { deps, handlers } = setup();
    const request = (user: string) => new Request("https://do/status", { headers: { "X-Auth-User": user } });
    expect((await routeSessionRequest(request("alice"), deps)).status).toBe(200);
    expect(handlers.status).toHaveBeenCalledOnce();
    expect((await routeSessionRequest(request("bob"), deps)).status).toBe(403);
    expect(handlers.status).toHaveBeenCalledOnce();
  });

  it("allows read-only admins without claiming an unowned session", async () => {
    const { deps, rows, handlers } = setup();
    const res = await routeSessionRequest(
      new Request("https://do/history", { headers: { "X-Auth-User": "admin", "X-Auth-Admin": "1" } }),
      deps,
    );
    expect(res.status).toBe(200);
    expect(rows.has("owner")).toBe(false);
    expect(handlers.history).toHaveBeenCalledOnce();
  });

  it("keeps the public method/path contract exact", async () => {
    const { deps, handlers } = setup();
    const res = await routeSessionRequest(new Request("https://do/status", { method: "POST", headers: { "X-Auth-User": "alice" } }), deps);
    expect(res.status).toBe(404);
    expect(handlers.status).not.toHaveBeenCalled();
  });
});
