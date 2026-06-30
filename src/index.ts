/** Worker entry — routes requests to the correct Durable Object session. */

import { getConfig } from "./config";
import { handleSessionsApi, resolveUser } from "./sessions";

export { AgentSession } from "./session";

export interface Env {
  SESSION: DurableObjectNamespace;
  DB: D1Database;
  AUTH: Fetcher;
  GITHUB_TOKEN: string;
  CF_API_TOKEN: string;
  CF_ACCOUNT_ID: string;
  CF_GLOBAL_KEY: string;
  CF_EMAIL: string;
  STORE: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
}

// Dev origins only — exact host match so e.g. `http://localhost.evil.com` (a
// prefix match) can't slip through and make credentialed requests.
const DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function corsHeaders(request: Request, domain: string): Record<string, string> {
  const origin = request.headers.get("Origin");
  // Credentialed CORS (cookie auth) is restricted to the store's own domain +
  // subdomains and localhost dev. No `*.pages.dev` wildcard — any attacker can
  // deploy a Pages site, and reflecting it back with credentials would let it
  // ride a signed-in user's fgs_token cookie.
  const allowed =
    origin && (origin === `https://${domain}` || origin.endsWith(`.${domain}`) || DEV_ORIGIN.test(origin)) ? origin : `https://${domain}`;
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const config = getConfig(env.STORE);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, config.domain) });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Per-user session list (D1) — /sessions, /sessions/:id
    const sessionsResp = await handleSessionsApi(request, env, config.domain, corsHeaders(request, config.domain));
    if (sessionsResp) return sessionsResp;

    // Health check
    if (path === "/" || path === "/health") {
      return new Response(
        JSON.stringify({
          ok: true,
          service: config.agentName,
          hasSecrets: !!(env.GITHUB_TOKEN && env.CF_API_TOKEN),
        }),
        {
          headers: { "Content-Type": "application/json", ...corsHeaders(request, config.domain) },
        },
      );
    }

    // Routes: /session/:id/chat, /session/:id/status, /session/:id/files, /session/:id/reset
    const match = path.match(/^\/session\/([a-zA-Z0-9_-]{1,64})\/(chat|status|files|history|errors|reset|push-subscribe)$/);
    if (!match) {
      return new Response(JSON.stringify({ error: "not found", hint: "Use /session/:id/chat" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...corsHeaders(request, config.domain) },
      });
    }

    const [, sessionId, route] = match;

    // Authenticate: every /session/* route requires a valid FGS session. The DO
    // (one per session) has no edge route of its own, so identity is established
    // here — verified via the auth worker's /me over the service binding — and
    // the DO binds the session to its owner (trust-on-first-use).
    const user = await resolveUser(request, env.AUTH);
    if (!user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders(request, config.domain) },
      });
    }

    const subpath = `/${route}`;
    const doId = env.SESSION.idFromName(sessionId);
    const stub = env.SESSION.get(doId);

    // Forward to the DO with the worker-verified identity. set() overwrites any
    // client-supplied X-Auth-User, so a caller can't spoof session ownership.
    const fwdHeaders = new Headers(request.headers);
    fwdHeaders.set("X-Auth-User", user.id);
    const doRequest = new Request(`https://do${subpath}`, {
      method: request.method,
      headers: fwdHeaders,
      body: request.method === "POST" ? request.body : undefined,
    });

    return stub.fetch(doRequest);
  },
};
