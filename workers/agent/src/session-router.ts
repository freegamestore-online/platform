/** HTTP transport boundary for AgentSession.
 *
 * The Durable Object deliberately supplies the handlers: this module owns no
 * session data and can therefore be exercised without a Durable Object runtime.
 */
import { corsHeaders as sharedCorsHeaders } from "@freegamestore/contracts";
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

export const corsHeaders = sharedCorsHeaders;

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

    // `return await`, not `return`: an un-awaited promise returned from inside
    // `try` rejects past this catch, escaping the DO as an opaque CF 500 with no
    // CORS headers instead of the JSON error below (#85).
    const route = `${request.method} ${path}`;
    switch (route) {
      case "POST /chat":
        return await handlers.chat(request);
      case "GET /status":
        return await handlers.status(request);
      case "GET /files":
        return await handlers.files(request);
      case "GET /history":
        return await handlers.history(request);
      case "GET /errors":
        return await handlers.errors(request);
      case "POST /import":
        return await handlers.import(request);
      case "POST /reset":
        return await handlers.reset(request);
      case "POST /push-subscribe":
        return await handlers.pushSubscribe(request);
      default:
        return jsonResponse({ error: "not found" }, 404, request, config.domain);
    }
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500, request, config.domain);
  }
}
