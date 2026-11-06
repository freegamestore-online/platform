import { describe, expect, it } from "vitest";
import worker from "./index";

// #462: games share the agent's site, so the __Host-fgs_token cookie rides along
// on a game page's credentialed fetch. Cookie-authenticated writes must come
// from the Studio's origin; header-authenticated (server-to-server) calls are
// untouched.

const BASE = "https://agent.freegamestore.online";
const COOKIE = "__Host-fgs_token=tok";
const CONSOLE = "https://console.freegamestore.online";
const GAME = "https://evil.freegamestore.online";

// The auth binding records whether it was consulted and denies the token, so a
// request that passes the guard ends at 401 (or the handler's own status) and
// one the guard stops never reaches auth.
function makeEnv() {
  const seen = { auth: 0 };
  const env = {
    STORE: "games",
    DB: {} as D1Database,
    AUTH: {
      fetch: async () => {
        seen.auth++;
        return new Response("no", { status: 401 });
      },
    },
  } as unknown as Parameters<typeof worker.fetch>[1];
  return { env, seen };
}

function req(method: string, path: string, headers: Record<string, string>, body?: string) {
  return new Request(`${BASE}${path}`, { method, headers, body });
}

const ctx = {} as ExecutionContext;

describe("agent same-site CSRF guard (#462)", () => {
  const writes: [string, string, string | undefined][] = [
    ["POST", "/session/abc/chat", '{"message":"hi"}'],
    ["POST", "/session/abc/import", '{"id":"chess"}'],
    ["POST", "/session/abc/reset", undefined],
    ["PUT", "/sessions/abc", '{"title":"x"}'],
    ["DELETE", "/sessions/abc", undefined],
    ["PUT", "/v1/keys/anthropic", '{"key":"k"}'],
    ["DELETE", "/v1/keys/anthropic", undefined],
    ["POST", "/kidify", '{"text":"x"}'],
    ["DELETE", "/v1/account", undefined],
  ];

  for (const [method, path, body] of writes) {
    it(`403s a cookie ${method} ${path} from a game origin`, async () => {
      const { env, seen } = makeEnv();
      const res = await worker.fetch(
        req(method, path, { Cookie: COOKIE, Origin: GAME, "Content-Type": "text/plain" }, body),
        env,
        ctx,
      );
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "forbidden origin" });
      expect(seen.auth).toBe(0);
    });
  }

  it("403s a cookie write with no Origin unless Sec-Fetch-Site is same-origin", async () => {
    const { env } = makeEnv();
    const blind = await worker.fetch(req("POST", "/session/abc/reset", { Cookie: COOKIE }), env, ctx);
    expect(blind.status).toBe(403);
    const sameSite = await worker.fetch(
      req("POST", "/session/abc/reset", { Cookie: COOKIE, "Sec-Fetch-Site": "same-site" }),
      env,
      ctx,
    );
    expect(sameSite.status).toBe(403);
    const sameOrigin = await worker.fetch(
      req("POST", "/session/abc/reset", { Cookie: COOKIE, "Sec-Fetch-Site": "same-origin" }),
      env,
      ctx,
    );
    expect(sameOrigin.status).toBe(401);
  });

  it("415s a first-party cookie write to a body-reading route that isn't JSON", async () => {
    const { env, seen } = makeEnv();
    const res = await worker.fetch(
      req("POST", "/session/abc/chat", { Cookie: COOKIE, Origin: CONSOLE, "Content-Type": "text/plain" }, "{}"),
      env,
      ctx,
    );
    expect(res.status).toBe(415);
    expect(seen.auth).toBe(0);
  });

  it("lets the Studio's own calls through to authentication", async () => {
    const { env, seen } = makeEnv();
    const json = { Cookie: COOKIE, Origin: CONSOLE, "Content-Type": "application/json" };
    const chat = await worker.fetch(req("POST", "/session/abc/chat", json, '{"message":"hi"}'), env, ctx);
    expect(chat.status).toBe(401);
    // Body-less writes carry no Content-Type from the browser and must not 415.
    const reset = await worker.fetch(req("POST", "/session/abc/reset", { Cookie: COOKIE, Origin: CONSOLE }), env, ctx);
    expect(reset.status).toBe(401);
    const del = await worker.fetch(req("DELETE", "/v1/keys/anthropic", { Cookie: COOKIE, Origin: CONSOLE }), env, ctx);
    expect(del.status).toBe(401);
    expect(seen.auth).toBe(3);
  });

  it("does not gate reads, preflights, or header-authenticated server-to-server calls", async () => {
    const { env, seen } = makeEnv();
    const read = await worker.fetch(req("GET", "/session/abc/status", { Cookie: COOKIE, Origin: GAME }), env, ctx);
    expect(read.status).toBe(401);
    const preflight = await worker.fetch(req("OPTIONS", "/session/abc/chat", { Origin: CONSOLE }), env, ctx);
    expect(preflight.status).toBe(204);
    const mcp = await worker.fetch(
      req("POST", "/session/abc/import", { "X-FGS-Token": "t", "Content-Type": "application/json" }, "{}"),
      env,
      ctx,
    );
    expect(mcp.status).toBe(401);
    const bearer = await worker.fetch(req("POST", "/session/abc/reset", { Authorization: "Bearer t" }), env, ctx);
    expect(bearer.status).toBe(401);
    expect(seen.auth).toBe(3);
  });
});
