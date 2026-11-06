import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequestPost as consoleDelete } from "../../../apps/console/functions/auth/delete";
import authWorker, { jwtSign } from "../../auth/src/index";
import agentWorker from "./index";
import { INTERNAL_WIPE_PATH } from "./session-router";

// #483: account deletion end to end, with nothing mocked between the three
// services. The console's /auth/delete, the real auth worker and the real agent
// worker run against in-memory D1/DO stand-ins, and the user holds a REAL
// console-audience session signed with a test key. The old test mocked /me, so
// it never noticed the agent refuses console sessions (#69) and every real
// deletion failed.

const SECRET = "integration-test-secret";
const USER = "github:4242";
const CONSOLE = "https://console.freegamestore.online";

type AuthEnv = Parameters<typeof authWorker.fetch>[1];
type AgentEnv = Parameters<typeof agentWorker.fetch>[1];

/** Just enough D1 for both workers: records every bound statement. */
function fakeD1(sessions: string[]) {
  const runs: { sql: string; args: unknown[] }[] = [];
  const consumed = new Set<unknown>();
  const stmt = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: sql.includes("FROM agent_sessions") ? sessions.map((session_id) => ({ session_id })) : [] }),
    first: async () => null,
    run: async () => {
      runs.push({ sql, args });
      let changes = 1;
      if (sql.startsWith("INSERT OR IGNORE INTO handoff_consumed")) {
        changes = consumed.has(args[0]) ? 0 : 1;
        consumed.add(args[0]);
      }
      return { success: true, meta: { changes } };
    },
  });
  return { db: { prepare: (sql: string) => stmt(sql) } as unknown as D1Database, runs };
}

function setup(opts: { sessions?: string[]; wipeStatus?: number } = {}) {
  const sessions = opts.sessions ?? ["s1", "s2"];
  const authDb = fakeD1([]);
  const agentDb = fakeD1(sessions);
  const wiped: string[] = [];
  const authEnv = { JWT_SECRET: SECRET, DB: authDb.db } as unknown as AuthEnv;
  const agentEnv = {
    STORE: "games",
    INTERNAL_TOKEN: "internal",
    DB: agentDb.db,
    // The agent reaches auth over a service binding.
    AUTH: { fetch: (input: RequestInfo, init?: RequestInit) => authWorker.fetch(new Request(input, init), authEnv) },
    SESSION: {
      idFromName: (name: string) => name,
      get: (id: string) => ({
        fetch: async (req: Request) => {
          if (new URL(req.url).pathname !== INTERNAL_WIPE_PATH || req.headers.get("X-Internal-Token") !== "internal") {
            return new Response("no", { status: 404 });
          }
          wiped.push(id);
          return new Response(null, { status: opts.wipeStatus ?? 204 });
        },
      }),
    },
  } as unknown as AgentEnv;

  // The console function reaches both workers by their public URLs.
  vi.stubGlobal("fetch", async (input: RequestInfo, init?: RequestInit) => {
    const req = new Request(input, init);
    const host = new URL(req.url).host;
    if (host === "auth.freegamestore.online") return authWorker.fetch(req, authEnv);
    if (host === "agent.freegamestore.online") return agentWorker.fetch(req, agentEnv, {} as ExecutionContext);
    throw new Error(`unexpected fetch ${req.url}`);
  });

  const deleted = (db: typeof authDb, table: string) =>
    db.runs.some((r) => r.sql.startsWith(`DELETE FROM ${table} WHERE`) && r.args[0] === USER);
  return { authDb, agentDb, wiped, deleted };
}

/** What auth's /handoff/consume mints for the console: the browser's cookie. */
async function consoleSession(aud = CONSOLE): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return jwtSign({ typ: "fgs_session", aud, sub: USER, login: "deleter", iat: now, exp: now + 3600 }, SECRET);
}

async function postDelete(token: string): Promise<Response> {
  const request = new Request(`${CONSOLE}/auth/delete`, {
    method: "POST",
    headers: { Cookie: `__Host-fgs_token=${token}`, Origin: CONSOLE },
  });
  return consoleDelete({ request, env: {} } as unknown as Parameters<typeof consoleDelete>[0]);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("account deletion across console, agent and auth (#483)", () => {
  it("deletes the agent data, BYO keys, grants and the auth record for a real console session", async () => {
    const { authDb, agentDb, wiped, deleted } = setup();
    const res = await postDelete(await consoleSession());
    const body = (await res.json()) as { ok: boolean };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(wiped).toEqual(["s1", "s2"]);
    for (const table of ["agent_sessions", "user_api_keys", "complimentary_grants"]) {
      expect(deleted(agentDb, table), table).toBe(true);
    }
    expect(deleted(authDb, "users")).toBe(true);
    expect(res.headers.getSetCookie().some((c) => c.startsWith("__Host-fgs_token=;"))).toBe(true);
  });

  it("the agent still refuses the console session itself, so the exchange is what makes it work", async () => {
    setup();
    const res = await fetch("https://agent.freegamestore.online/v1/account", {
      method: "DELETE",
      headers: { "X-FGS-Token": await consoleSession() },
    });
    expect(res.status).toBe(401);
  });

  it("reports failure and keeps the auth record when a session wipe fails", async () => {
    const { authDb, deleted } = setup({ wipeStatus: 500 });
    const res = await postDelete(await consoleSession());
    expect(res.status).toBe(502);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(false);
    expect(deleted(authDb, "users")).toBe(false);
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });

  it("deletes nothing for a session minted for another site", async () => {
    const { authDb, agentDb, wiped, deleted } = setup();
    const res = await postDelete(await consoleSession("https://mcp.freegamestore.online"));
    expect(res.status).toBe(401);
    expect(wiped).toEqual([]);
    expect(deleted(agentDb, "agent_sessions")).toBe(false);
    expect(deleted(authDb, "users")).toBe(false);
  });
});
