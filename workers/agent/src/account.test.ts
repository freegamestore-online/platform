import { describe, expect, it, vi } from "vitest";
import { handleAccountDelete } from "./account";
import type { Env } from "./index";

describe("agent: DELETE /v1/account", () => {
  async function callDelete(token = "user.token.here") {
    const mockDB = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          all: vi.fn().mockResolvedValue({ results: [{ session_id: "sess1" }] }),
          run: vi.fn().mockResolvedValue({ success: true }),
          first: vi.fn().mockResolvedValue(null),
        }),
      }),
    } as unknown as D1Database;

    const mockSession = { fetch: vi.fn().mockResolvedValue(new Response(null, { status: 204 })) };
    const mockSessionNS = {
      idFromName: vi.fn().mockReturnValue("do-id"),
      get: vi.fn().mockReturnValue(mockSession),
    } as unknown as DurableObjectNamespace;

    const mockAuth = {
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "user123" }), { status: 200 })),
    } as unknown as Fetcher;

    const env: Env = {
      DB: mockDB,
      SESSION: mockSessionNS,
      AUTH: mockAuth,
    } as Env;

    const request = new Request("https://agent.freegamestore.online/v1/account", {
      method: "DELETE",
      headers: { "X-FGS-Token": token },
    });

    const cors = { "Access-Control-Allow-Origin": "*" };
    const response = await handleAccountDelete(request, env, { domain: "freegamestore.online" } as any, cors);
    return { response, mockDB, mockAuth, mockSession };
  }

  it("deletes all user data on successful request", async () => {
    const { response, mockDB } = await callDelete();
    expect(response?.status).toBe(200);

    const body = (await response?.json()) as { ok?: boolean };
    expect(body.ok).toBe(true);

    // Verify the DB prepare was called for each delete operation
    const calls = mockDB.prepare.mock.calls;
    const deleteStatements = calls.map((c: any[]) => c[0]).filter((sql: string) => sql.includes("DELETE FROM"));
    expect(deleteStatements.length).toBeGreaterThan(0);
  });

  it("requires authentication", async () => {
    const mockDB = { prepare: vi.fn() } as unknown as D1Database;
    const mockAuth = {
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 })),
    } as unknown as Fetcher;

    const env: Env = { DB: mockDB, AUTH: mockAuth } as Env;

    const request = new Request("https://agent.freegamestore.online/v1/account", {
      method: "DELETE",
      headers: {},
    });

    const response = await handleAccountDelete(request, env, {} as any, {});
    expect(response?.status).toBe(401);
  });

  it("returns 404 for non-DELETE requests", async () => {
    const mockDB = {} as unknown as D1Database;
    const env: Env = { DB: mockDB } as Env;

    const request = new Request("https://agent.freegamestore.online/v1/account", {
      method: "GET",
    });

    const response = await handleAccountDelete(request, env, {} as any, {});
    expect(response).toBeNull();
  });

  it("handles DO storage deletion errors gracefully", async () => {
    const mockDB = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          all: vi.fn().mockResolvedValue({ results: [{ session_id: "sess1" }] }),
          run: vi.fn().mockResolvedValue({ success: true }),
        }),
      }),
    } as unknown as D1Database;

    const mockSession = {
      fetch: vi.fn().mockRejectedValue(new Error("DO fetch failed")),
    };
    const mockSessionNS = {
      idFromName: vi.fn().mockReturnValue("do-id"),
      get: vi.fn().mockReturnValue(mockSession),
    } as unknown as DurableObjectNamespace;

    const mockAuth = {
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "user123" }), { status: 200 })),
    } as unknown as Fetcher;

    const env: Env = { DB: mockDB, SESSION: mockSessionNS, AUTH: mockAuth } as Env;

    const request = new Request("https://agent.freegamestore.online/v1/account", {
      method: "DELETE",
      headers: { "X-FGS-Token": "token" },
    });

    // Should continue even if DO deletion fails
    const response = await handleAccountDelete(request, env, {} as any, {});
    expect(response?.status).toBe(200);
  });
});
