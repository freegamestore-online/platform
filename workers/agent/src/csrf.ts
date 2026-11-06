// Same-site CSRF guard for the agent's cookie-authenticated routes (#462).
//
// The Studio's agent session is a `__Host-fgs_token` cookie with SameSite=Lax.
// Games are published on sibling subdomains (<game>.freegamestore.online), the
// SAME SITE as agent.freegamestore.online, so SameSite does nothing against
// them: a game page can POST /session/:id/chat or DELETE /v1/keys/:provider with
// credentials:'include' and the browser attaches the creator's cookie. A
// state-changing cookie request must therefore come from a first-party origin
// (or, with no Origin, be same-origin by the browser's own Sec-Fetch-Site), and
// a handler that reads a body must get JSON — a `text/plain` POST needs no CORS
// preflight, so it is exactly what a game would send blind. Mirrors the console
// guard (apps/console/functions/api/_csrf.ts, #460) and the admin router (#62).
//
// Requests authenticated by X-FGS-Token / Authorization (MCP, the admin worker,
// the CLI) are server-to-server and carry no ambient credential, so they are
// not gated. A browser can't add those headers cross-origin without a preflight,
// which CORS refuses.

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Routes whose handler reads a JSON body. Body presence can't be inferred from
// the request — workerd hands a body-less POST a non-null `request.body` and the
// browser sends no Content-Type for it — so body-less routes (DELETEs,
// /session/:id/reset) must not be listed here or they would 415 (3d7522c).
const BODY_ROUTES: { method: string; path: RegExp }[] = [
  { method: "PUT", path: /^\/sessions\/[^/]+$/ },
  { method: "PUT", path: /^\/v1\/keys\/[^/]+$/ },
  { method: "POST", path: /^\/kidify$/ },
  { method: "POST", path: /^\/session\/[^/]+\/(chat|import|push-subscribe)$/ },
  { method: "POST", path: /^\/v1\/admin\/session-chat$/ },
];

function reject(error: string, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors },
  });
}

/**
 * Returns a 403/415 for a state-changing, cookie-authenticated request that did
 * not come from a first-party page, or null when routing may proceed.
 */
export function rejectCrossSite(
  request: Request,
  domain: string,
  cors: Record<string, string>,
  devOrigin?: string,
): Response | null {
  if (SAFE_METHODS.has(request.method)) return null;
  const headerAuth =
    !!request.headers.get("X-FGS-Token") || (request.headers.get("Authorization") ?? "").startsWith("Bearer ");
  const cookieAuth = /(?:^|;\s*)__Host-fgs_token=/.test(request.headers.get("Cookie") ?? "");
  if (headerAuth || !cookieAuth) return null;

  const origin = request.headers.get("Origin");
  const firstParty =
    origin === null
      ? request.headers.get("Sec-Fetch-Site") === "same-origin"
      : origin === `https://console.${domain}` || (!!devOrigin && origin === devOrigin);
  if (!firstParty) return reject("forbidden origin", 403, cors);

  const path = new URL(request.url).pathname;
  if (
    BODY_ROUTES.some((r) => r.method === request.method && r.path.test(path)) &&
    request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json"
  ) {
    return reject("application/json required", 415, cors);
  }
  return null;
}
