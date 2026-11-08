import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequestPost as consoleDelete } from "../../../apps/console/functions/auth/delete";
import { handleAdminAuthRoute, resolveCaller } from "../../../apps/admin/src/caller";
import { dispatchApiRoute } from "../../../apps/admin/src/routes/dispatch";
import { resolveCreatorUser } from "../../../apps/console/functions/api/_auth";
import authWorker, { jwtSign } from "../../auth/src/index";
import { sqliteD1 } from "../../auth/test/sqlite-d1";
import { refuseRevokedGrant } from "../../mcp/src/auth-handler";
import agentWorker from "./index";
import { INTERNAL_WIPE_PATH } from "./session-router";

// #483: account deletion end to end, with nothing mocked between the three
// services. The console's /auth/delete, the real auth worker and the real agent
// worker run against in-memory D1/DO stand-ins, and the user holds a REAL
// console-audience session signed with a test key. The old test mocked /me, so
// it never noticed the agent refuses console sessions (#69) and every real
// deletion failed.
//
// #499: after deletion, every token issued before it is refused by each
// service that trusts one (agent, MCP, admin, console), and a fresh sign-in
// works. Auth runs on a real SQLite D1 here, so its SQL runs as written.

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
  // The user signed in, so auth has their row.
  const authDb = sqliteD1([USER]);
  const agentDb = fakeD1(sessions);
  const wiped: string[] = [];
  const authEnv = { JWT_SECRET: SECRET, DB: authDb } as unknown as AuthEnv;
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

  // Admin's revocation store (#500), from the real migration. Admin reaches auth
  // over a service binding, so the console session meets auth's real audience check.
  const adminDb = sqliteD1();
  adminDb.sqlite.exec(readFileSync(new URL("../../host/migrations/0006_admin_session_revocations.sql", import.meta.url), "utf8"));
  const adminEnv = { AUTH: agentEnv.AUTH, DB: adminDb, SESSION_SIGNING_KEY: "admin-key" } as unknown as Parameters<typeof handleAdminAuthRoute>[1];

  // The console function reaches the workers by their public URLs.
  vi.stubGlobal("fetch", async (input: RequestInfo, init?: RequestInit) => {
    const req = new Request(input, init);
    const host = new URL(req.url).host;
    if (host === "auth.freegamestore.online") return authWorker.fetch(req, authEnv);
    if (host === "agent.freegamestore.online") return agentWorker.fetch(req, agentEnv, {} as ExecutionContext);
    if (host === "admin.freegamestore.online") return (await handleAdminAuthRoute(req, adminEnv)) ?? new Response("no route", { status: 404 });
    if (host === "api.github.com" || host === "raw.githubusercontent.com") return new Response("{}", { status: 404 });
    throw new Error(`unexpected fetch ${req.url}`);
  });

  const deleted = (db: typeof agentDb, table: string) =>
    db.runs.some((r) => r.sql.startsWith(`DELETE FROM ${table} WHERE`) && r.args[0] === USER);
  const authUserDeleted = () => !authDb.sqlite.prepare("SELECT 1 FROM users WHERE id = ?").get(USER);
  return { authDb, adminDb, agentDb, wiped, deleted, authUserDeleted, agentEnvAuth: (agentEnv as unknown as { AUTH: Fetcher }).AUTH };
}

/** What auth's /handoff/consume mints for the console: the browser's cookie. */
async function consoleSession(aud = CONSOLE, iat = Math.floor(Date.now() / 1000)): Promise<string> {
  return jwtSign({ typ: "fgs_session", aud, sub: USER, login: "deleter", iat, exp: iat + 3600 }, SECRET);
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
    const { adminDb, agentDb, wiped, deleted, authUserDeleted } = setup();
    const res = await postDelete(await consoleSession());
    const body = (await res.json()) as { ok: boolean };
    expect(res.status).toBe(200);
    // Admin signs its own CLI sessions, so it records its own watermark (#500).
    expect(adminDb.sqlite.prepare("SELECT subject FROM admin_session_revocations ORDER BY subject").all().map((r) => r.subject)).toEqual(["gid:4242", "login:deleter"]);
    expect(body.ok).toBe(true);
    expect(wiped).toEqual(["s1", "s2"]);
    for (const table of ["agent_sessions", "user_api_keys", "complimentary_grants"]) {
      expect(deleted(agentDb, table), table).toBe(true);
    }
    expect(authUserDeleted()).toBe(true);
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
    const { authUserDeleted } = setup({ wipeStatus: 500 });
    const res = await postDelete(await consoleSession());
    expect(res.status).toBe(502);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(false);
    expect(authUserDeleted()).toBe(false);
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });

  it("deletes nothing for a session minted for another site", async () => {
    const { agentDb, wiped, deleted, authUserDeleted } = setup();
    const res = await postDelete(await consoleSession("https://mcp.freegamestore.online"));
    expect(res.status).toBe(401);
    expect(wiped).toEqual([]);
    expect(deleted(agentDb, "agent_sessions")).toBe(false);
    expect(authUserDeleted()).toBe(false);
  });
});

describe("tokens issued before deletion are dead everywhere (#499)", () => {
  const AGENT = "https://agent.freegamestore.online";
  const MCP = "https://mcp.freegamestore.online";
  const ADMIN = "https://admin.freegamestore.online";

  /** The services each token is presented to, with a 2xx/401 verdict apiece. */
  async function verdicts(env: ReturnType<typeof setup>, tokens: { agent: string; mcp: string; admin: string; console: string }) {
    const agentRes = await fetch(`${AGENT}/sessions`, { headers: { "X-FGS-Token": tokens.agent } });
    const mcpRes = await refuseRevokedGrant(env.agentEnvAuth, { token: tokens.mcp });
    const adminEnv = { AUTH: env.agentEnvAuth, SESSION_SIGNING_KEY: "admin-key" } as unknown as Parameters<typeof resolveCaller>[1];
    // A creator write: PATCH /api/games/:id is login-gated in admin's router.
    const adminRes = await dispatchApiRoute(
      new Request(`${ADMIN}/api/games/chess`, { method: "PATCH", headers: { "X-FGS-Token": tokens.admin } }),
      adminEnv,
      {} as never,
    );
    const consoleUser = await resolveCreatorUser(
      new Request(`${CONSOLE}/api/me`, { headers: { Cookie: `__Host-fgs_token=${tokens.console}` } }),
      { JWT_SECRET: SECRET } as never,
    );
    return {
      agent: agentRes.status,
      mcp: mcpRes?.status ?? 200,
      adminLogin: (await resolveCaller(new Request(`${ADMIN}/`, { headers: { "X-FGS-Token": tokens.admin } }), adminEnv)).login,
      admin: adminRes?.status,
      console: consoleUser?.github ?? null,
    };
  }

  async function tokensIssued(ago: number) {
    const iat = Math.floor(Date.now() / 1000) - ago;
    return {
      agent: await consoleSession(AGENT, iat),
      mcp: await consoleSession(MCP, iat),
      admin: await consoleSession(MCP, iat), // MCP forwards its session to admin
      console: await consoleSession(CONSOLE, iat),
    };
  }

  it("a pre-deletion token gets 401 from agent, MCP and admin, and no console identity", async () => {
    const env = setup();
    const before = await tokensIssued(0);
    const live = await verdicts(env, before);
    expect(live).toMatchObject({ agent: 200, mcp: 200, adminLogin: "deleter", console: "deleter" });
    expect(live.admin).not.toBe(401);

    expect((await postDelete(await consoleSession())).status).toBe(200);

    expect(await verdicts(env, before)).toEqual({ agent: 401, mcp: 401, adminLogin: null, admin: 401, console: null });
  });

  it("a fresh sign-in after deletion works, and the old tokens stay dead", async () => {
    const env = setup();
    const old = await tokensIssued(30);
    expect((await postDelete(await consoleSession(CONSOLE, Math.floor(Date.now() / 1000) - 30))).status).toBe(200);
    // The user signs in again later: the OAuth callback upserts a new users row
    // and every token from here on is issued after the deletion.
    env.authDb.sqlite.prepare("UPDATE session_revocations SET revoked_at_ms = revoked_at_ms - 5000").run();
    env.authDb.sqlite.prepare("INSERT INTO users (id, name) VALUES (?, 'again')").run(USER);
    const fresh = await tokensIssued(0);

    const now = await verdicts(env, fresh);
    expect(now).toMatchObject({ agent: 200, mcp: 200, adminLogin: "deleter", console: "deleter" });
    expect(now.admin).not.toBe(401);
    expect(await verdicts(env, old)).toEqual({ agent: 401, mcp: 401, adminLogin: null, admin: 401, console: null });
  });
});
