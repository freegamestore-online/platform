/** Worker entry — routes requests to the correct Durable Object session. */

import { getConfig } from "./config";
import { handleAdminSessionsApi, handleSessionsApi, isOrgAdmin, resolveUser } from "./sessions";
import { handleKeysApi } from "./keys";
import { handleAdminCompApi } from "./admin-comp";
import { handleKidify } from "./kidify";

export { AgentSession } from "./session";

export interface Env {
  SESSION: DurableObjectNamespace;
  DB: D1Database;
  AUTH: Fetcher;
  /** Path B: admin worker (host route + registry writes) + shared internal token. */
  ADMIN: Fetcher;
  INTERNAL_TOKEN: string;
  GITHUB_TOKEN: string;
  CF_API_TOKEN: string;
  CF_ACCOUNT_ID: string;
  STORE: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  /** Base64 32-byte master key wrapping per-user AI-key DEKs (see keys.ts). */
  AI_KEYS_KEK: string;
  /** Platform-funded provider keys for complimentary grants (keygrants.ts).
   *  Optional — a grant on a provider whose key is unset simply doesn't resolve. */
  COMP_KEY_ANTHROPIC?: string;
  COMP_KEY_OPENAI?: string;
  COMP_KEY_GOOGLE?: string;
  COMP_KEY_GITHUB?: string;
}

// Dev origins only — exact host match so e.g. `http://localhost.evil.com` (a
// prefix match) can't slip through and make credentialed requests.
const DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function corsHeaders(request: Request, domain: string): Record<string, string> {
  const origin = request.headers.get("Origin");
  // Credentialed CORS (cookie auth) is restricted to the FIRST-PARTY console
  // origins only — NOT `*.${domain}`. Published games are untrusted, user/
  // agent-authored JS served at `<slug>.${domain}`; reflecting those with
  // credentials would let a malicious/XSS'd game ride a signed-in user's
  // fgs_token cookie to read transcripts + key status and drive /chat. The
  // console is served only at `console.`/`publish.`.
  const firstParty = origin === `https://console.${domain}` || origin === `https://publish.${domain}`;
  const allowed = origin && (firstParty || DEV_ORIGIN.test(origin)) ? origin : `https://console.${domain}`;
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
  };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const config = getConfig(env.STORE);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, config.domain) });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Per-user session list (D1) — /sessions, /sessions/:id
    const sessionsResp = await handleSessionsApi(request, env, config.domain, corsHeaders(request, config.domain));
    if (sessionsResp) return sessionsResp;

    // Admin all-users session list (org members only) — GET /admin/sessions
    const adminSessionsResp = await handleAdminSessionsApi(request, env, config, corsHeaders(request, config.domain));
    if (adminSessionsResp) return adminSessionsResp;

    // Per-user AI-key vault (D1, encrypted) — /v1/keys/status, /v1/keys/:provider
    const keysResp = await handleKeysApi(request, env, corsHeaders(request, config.domain));
    if (keysResp) return keysResp;

    // Internal admin: complimentary grants — /v1/admin/comp (INTERNAL_TOKEN gated,
    // called by the admin worker over its service binding).
    const compResp = await handleAdminCompApi(request, env, corsHeaders(request, config.domain), ctx);
    if (compResp) return compResp;

    // Kid-friendly message rewrite (free tier, platform token) — POST /kidify
    const kidResp = await handleKidify(request, env, corsHeaders(request, config.domain));
    if (kidResp) return kidResp;

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

    // Routes: /session/:id/chat, /session/:id/status, /session/:id/files,
    // /session/:id/import (bind to an existing game), /session/:id/reset, …
    const match = path.match(/^\/session\/([a-zA-Z0-9_-]{1,64})\/(chat|status|files|history|errors|reset|import|push-subscribe)$/);
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
    // Admin read-through (?admin=1 on GET history/status): org members may read
    // any session's transcript/status — the "parent view". Verified HERE (the
    // client header is always stripped first, so it can't be spoofed) and only
    // for read routes; admins can't chat/reset as someone else.
    fwdHeaders.delete("X-Auth-Admin");
    if (
      url.searchParams.get("admin") === "1" &&
      request.method === "GET" &&
      (route === "history" || route === "status") &&
      user.login &&
      (await isOrgAdmin(config, env.GITHUB_TOKEN, user.login))
    ) {
      fwdHeaders.set("X-Auth-Admin", "1");
    }
    // The GitHub login (username) — used at deploy time to add the creator as a
    // collaborator on the repo the platform bot creates for them. set() so a
    // client can't spoof it. Blank when the session predates login capture.
    fwdHeaders.set("X-Auth-Login", user.login ?? "");
    // The DO is addressed by idFromName(sessionId) and can't recover the
    // original session id from its opaque DO id. Pass it so the DO can keep the
    // D1 /sessions index (cross-browser discovery) authoritative server-side.
    fwdHeaders.set("X-Session-Id", sessionId);
    const doRequest = new Request(`https://do${subpath}`, {
      method: request.method,
      headers: fwdHeaders,
      body: request.method === "POST" ? request.body : undefined,
    });

    return stub.fetch(doRequest);
  },
};
