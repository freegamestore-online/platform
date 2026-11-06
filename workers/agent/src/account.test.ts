import { describe, expect, it, vi } from "vitest";
import { handleAccountDelete } from "./account";
import type { Env } from "./index";
import { INTERNAL_WIPE_PATH } from "./session-router";

const INTERNAL_TOKEN = "internal-secret";

/** D1 stub that records every statement and the rows each one was bound with. */
function mockDb(sessions = ["sess1", "sess2"]) {
  const statements: string[] = [];
  const db = {
    prepare: vi.fn((sql: string) => {
      statements.push(sql);
      return {
        bind: vi.fn().mockReturnValue({
          all: vi.fn().mockResolvedValue({ results: sessions.map((session_id) => ({ session_id })) }),
          run: vi.fn().mockResolvedValue({ success: true }),
          first: vi.fn().mockResolvedValue(null),
        }),
      };
    }),
  };
  return { db: db as unknown as D1Database, statements };
}

/** DO namespace stub: `respond` decides each wipe's outcome by session id. */
function mockSessions(respond: (sessionId: string, req: Request) => Response | Promise<Response>) {
  const wipes: { sessionId: string; req: Request }[] = [];
  const ns = {
    idFromName: vi.fn((name: string) => name),
    get: vi.fn((sessionId: string) => ({
      fetch: vi.fn(async (req: Request) => {
        wipes.push({ sessionId, req });
        return respond(sessionId, req);
      }),
    })),
  };
  return { ns: ns as unknown as DurableObjectNamespace, wipes };
}

const mockAuth = (ok = true) =>
  ({
    fetch: vi.fn().mockResolvedValue(
      ok
        ? new Response(JSON.stringify({ id: "user123" }), { status: 200 })
        : new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
    ),
  }) as unknown as Fetcher;

function deleteRequest(token = "user.token.here") {
  return new Request("https://agent.freegamestore.online/v1/account", {
    method: "DELETE",
    headers: { "X-FGS-Token": token },
  });
}

const deletes = (statements: string[]) => statements.filter((sql) => sql.includes("DELETE FROM"));

describe("agent: DELETE /v1/account", () => {
  it("wipes every session DO through the token-gated internal route, then deletes the D1 rows", async () => {
    const { db, statements } = mockDb(["sess1", "sess2"]);
    const { ns, wipes } = mockSessions(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const env = { DB: db, SESSION: ns, AUTH: mockAuth(), INTERNAL_TOKEN } as unknown as Env;

    const response = await handleAccountDelete(deleteRequest(), env, { domain: "freegamestore.online" } as any, {});
    expect(response?.status).toBe(200);
    expect(((await response?.json()) as { ok?: boolean }).ok).toBe(true);

    // Both DOs received the real wipe route with the shared secret (#459) —
    // not the old nonexistent /storage/delete-all with a made-up header.
    expect(wipes.map((w) => w.sessionId)).toEqual(["sess1", "sess2"]);
    for (const { req } of wipes) {
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe(INTERNAL_WIPE_PATH);
      expect(req.headers.get("X-Internal-Token")).toBe(INTERNAL_TOKEN);
    }
    expect(deletes(statements)).toEqual([
      expect.stringContaining("agent_sessions"),
      expect.stringContaining("user_api_keys"),
      expect.stringContaining("complimentary_grants"),
      expect.stringContaining("rate_limits"),
    ]);
  });

  it("requires authentication", async () => {
    const { db } = mockDb();
    const env = { DB: db, AUTH: mockAuth(false), INTERNAL_TOKEN } as unknown as Env;
    const response = await handleAccountDelete(deleteRequest(), env, {} as any, {});
    expect(response?.status).toBe(401);
  });

  it("returns null for non-DELETE requests", async () => {
    const env = { DB: {} as D1Database } as Env;
    const request = new Request("https://agent.freegamestore.online/v1/account", { method: "GET" });
    expect(await handleAccountDelete(request, env, {} as any, {})).toBeNull();
  });

  it("fails loudly when a DO wipe is refused: 500, ok:false, and NO index rows deleted", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { db, statements } = mockDb(["sess1", "sess2"]);
      // sess2 answers like the old router did to the old request: 401.
      const { ns, wipes } = mockSessions((id) =>
        id === "sess2"
          ? new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 })
          : new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
      const env = { DB: db, SESSION: ns, AUTH: mockAuth(), INTERNAL_TOKEN } as unknown as Env;

      const response = await handleAccountDelete(deleteRequest(), env, {} as any, {});
      expect(response?.status).toBe(500);
      const body = (await response?.json()) as { ok?: boolean; failedSessions?: string[] };
      expect(body.ok).toBe(false);
      expect(body.failedSessions).toEqual(["sess2"]);
      expect(wipes).toHaveLength(2); // sess1 still wiped; sess2 reported
      // The index rows survive so a retry finds sess2 again.
      expect(deletes(statements)).toEqual([]);
      expect(error).toHaveBeenCalledWith(expect.stringContaining("sess2"));
    } finally {
      error.mockRestore();
    }
  });

  it("fails loudly when a DO fetch throws", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { db, statements } = mockDb(["sess1"]);
      const { ns } = mockSessions(() => {
        throw new Error("DO fetch failed");
      });
      const env = { DB: db, SESSION: ns, AUTH: mockAuth(), INTERNAL_TOKEN } as unknown as Env;
      const response = await handleAccountDelete(deleteRequest(), env, {} as any, {});
      expect(response?.status).toBe(500);
      expect(deletes(statements)).toEqual([]);
    } finally {
      error.mockRestore();
    }
  });

  it("refuses to run without INTERNAL_TOKEN rather than sending unauthenticated wipes", async () => {
    const { db, statements } = mockDb(["sess1"]);
    const { ns, wipes } = mockSessions(() => new Response(null, { status: 200 }));
    const env = { DB: db, SESSION: ns, AUTH: mockAuth() } as unknown as Env;
    const response = await handleAccountDelete(deleteRequest(), env, {} as any, {});
    expect(response?.status).toBe(500);
    expect(wipes).toEqual([]);
    expect(deletes(statements)).toEqual([]);
  });
});
