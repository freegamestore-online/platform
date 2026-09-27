/** HTTP transport boundary for AgentSession.
 *
 * The Durable Object deliberately supplies the handlers: this module owns no
 * session data and can therefore be exercised without a Durable Object runtime.
 */
import type { StoreConfig } from "./config";

export interface SessionRouteHandlers {
  chat(request: Request): Promise<Response>;
  status(request: Request): Promise<Response>;
  files(request: Request): Promise<Response>;
  history(request: Request): Promise<Response>;
  errors(request: Request): Promise<Response>;
  import(request: Request): Promise<Response>;
  reset(request: Request): Promise<Response>;
  pushSubscribe(request: Request): Promise<Response>;
}

export interface SessionRouterDeps {
  storage: Pick<DurableObjectStorage, "get" | "put">;
  config: Pick<StoreConfig, "domain">;
  handlers: SessionRouteHandlers;
}

const DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function corsHeaders(request: Request, domain: string): Record<string, string> {
  const origin = request.headers.get("Origin");
  // Published games are untrusted: only the first-party consoles and local dev
  // may make credentialed requests to a session.
  const firstParty = origin === `https://console.${domain}` || origin === `https://publish.${domain}`;
  const allowed = origin && (firstParty || DEV_ORIGIN.test(origin)) ? origin : `https://console.${domain}`;
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
  };
}

export function jsonResponse(data: unknown, status: number, request: Request, domain: string): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(request, domain) },
  });
}

/** Route and authorize a session request without coupling transport to turns. */
export async function routeSessionRequest(request: Request, deps: SessionRouterDeps): Promise<Response> {
  const { config, handlers, storage } = deps;
  const path = new URL(request.url).pathname;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, config.domain) });

  try {
    const caller = request.headers.get("X-Auth-User");
    if (!caller) return jsonResponse({ error: "unauthorized" }, 401, request, config.domain);

    const adminRead =
      request.headers.get("X-Auth-Admin") === "1" &&
      request.method === "GET" &&
      (path === "/history" || path === "/status" || path === "/errors");
    if (!adminRead) {
      const owner = await storage.get<string>("owner");
      if (!owner) await storage.put("owner", caller);
      else if (owner !== caller) return jsonResponse({ error: "forbidden" }, 403, request, config.domain);
    }

    const route = `${request.method} ${path}`;
    switch (route) {
      case "POST /chat":
        return handlers.chat(request);
      case "GET /status":
        return handlers.status(request);
      case "GET /files":
        return handlers.files(request);
      case "GET /history":
        return handlers.history(request);
      case "GET /errors":
        return handlers.errors(request);
      case "POST /import":
        return handlers.import(request);
      case "POST /reset":
        return handlers.reset(request);
      case "POST /push-subscribe":
        return handlers.pushSubscribe(request);
      default:
        return jsonResponse({ error: "not found" }, 404, request, config.domain);
    }
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500, request, config.domain);
  }
}
