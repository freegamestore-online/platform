import { afterEach, describe, expect, it, vi } from "vitest";
import { handleAdminCompApi } from "./admin-comp";

// #449: /v1/admin/session-chat runs a turn AS the session's owner, on their key or
// grant. Every call must say who is acting, and leave a log line saying so.

function setup() {
  const chats: Request[] = [];
  const env = {
    INTERNAL_TOKEN: "secret",
    GITHUB_TOKEN: "t",
    STORE: "games",
    DB: {
      prepare: (sql: string) => ({
        bind: () => ({
          first: async () => (/FROM agent_sessions/.test(sql) ? { user_id: "github:7", user_login: "grace" } : null),
        }),
      }),
    },
    SESSION: {
      idFromName: (n: string) => n,
      get: () => ({
        fetch: async (req: Request) => {
          chats.push(req);
          return new Response("data: ok\n\n", { headers: { "Content-Type": "text/event-stream" } });
        },
      }),
    },
    AUTH: { fetch: async () => new Response("no", { status: 401 }) },
  } as never;
  const call = (headers: Record<string, string>, body: unknown = { message: "hello", provider: "github" }) =>
    handleAdminCompApi(
      new Request("https://agent/v1/admin/session-chat?id=sess-1", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
      env,
      {},
    );
  return { chats, call };
}

afterEach(() => vi.restoreAllMocks());

describe("session-chat actor audit", () => {
  it("logs the acting admin, the owner and the session on every call, never the message", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { call, chats } = setup();
    const res = await call({ "X-Internal-Token": "secret", "X-Admin-Actor": "serge@example.com" }, {
      message: "secret prompt text",
      provider: "github",
    });
    expect(res!.status).toBe(200);
    expect(chats).toHaveLength(1);
    const line = String(log.mock.calls[0]![0]);
    expect(JSON.parse(line)).toEqual({
      event: "admin_session_chat",
      actor: "serge@example.com",
      via: "admin-worker",
      session: "sess-1",
      owner: "github:7",
      provider: "github",
      messageChars: 18,
    });
    expect(line).not.toContain("secret prompt text");
  });

  it("refuses a call that cannot name who is acting, before touching the session", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { call, chats } = setup();
    for (const headers of [{ "X-Internal-Token": "secret" }, { "X-Internal-Token": "secret", "X-Admin-Actor": "   " }]) {
      const res = await call(headers);
      expect(res!.status).toBe(400);
    }
    expect(chats).toHaveLength(0);
    expect(log).not.toHaveBeenCalled();
  });

  it("does not run for a caller that is neither internal nor an org admin", async () => {
    const { call, chats } = setup();
    expect((await call({ "X-Admin-Actor": "someone" }))!.status).toBe(403);
    expect(chats).toHaveLength(0);
  });
});
