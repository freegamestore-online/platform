/**
 * Same-site CSRF guard shared by the console functions, the agent and the admin
 * router (#460, #462, #489).
 *
 * The session cookie is `__Host-fgs_token`, SameSite=Lax. Games are published on
 * sibling subdomains of freegamestore.online, the SAME SITE as the console, so
 * SameSite does nothing against them: a game page can send a credentialed
 * request and the browser attaches the creator's cookie. Browsers always send
 * `Origin` on cross-origin and non-GET requests, so a state-changing request
 * must come from a first-party origin, or, with no Origin at all, be same-origin
 * by the browser's own account (Sec-Fetch-Site). A request with a body must also
 * be JSON: a `text/plain` POST needs no CORS preflight, so it is exactly what a
 * game would send blind.
 *
 * FGS-internal. Nothing here is shared with FAS.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface CrossSiteOptions {
  /** First-party origins, exact match. Never a `*.freegamestore.online` wildcard:
   *  games are untrusted content on the same registrable domain. */
  origins: Iterable<string>;
  /** Local development only (#486): one extra origin trusted like a first-party
   *  one. Pass the env's DEV_ORIGIN, which is unset in production. */
  devOrigin?: string;
  /** The handler reads a JSON body: also require `Content-Type: application/json`. */
  body?: boolean;
  /** Extra response headers, e.g. CORS. */
  headers?: Record<string, string>;
}

/**
 * Whether the request carries, or claims to carry, a body. `request.body !== null`
 * can't tell: the Workers runtime hands a body-less POST a non-null body (3d7522c,
 * and live on the admin router until #489). A body-less browser POST has no
 * Content-Type and `Content-Length: 0`; anything with a body has a length, a
 * transfer encoding or a Content-Type.
 */
export function declaresBody(request: Request): boolean {
  const length = Number(request.headers.get('Content-Length') ?? 0);
  return (
    request.headers.has('Content-Type') ||
    request.headers.has('Transfer-Encoding') ||
    (Number.isFinite(length) && length > 0)
  );
}

function reject(error: string, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra },
  });
}

/** 415 unless the request is `Content-Type: application/json`, else null. For
 *  callers whose credential is not ambient (so no origin check applies) but whose
 *  handler still wants JSON. */
export function requireJsonBody(
  request: Request,
  headers?: Record<string, string>,
): Response | null {
  return request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() ===
    'application/json'
    ? null
    : reject('application/json required', 415, headers);
}

/**
 * Returns a 403/415 for a state-changing request that did not come from a
 * first-party page, or null when the handler may proceed. Call it before reading
 * the session cookie.
 */
export function rejectCrossSite(request: Request, opts: CrossSiteOptions): Response | null {
  if (SAFE_METHODS.has(request.method)) return null;
  const origin = request.headers.get('Origin');
  const firstParty =
    origin === null
      ? request.headers.get('Sec-Fetch-Site') === 'same-origin'
      : [...opts.origins].includes(origin) || (!!opts.devOrigin && origin === opts.devOrigin);
  if (!firstParty) return reject('forbidden origin', 403, opts.headers);
  return opts.body ? requireJsonBody(request, opts.headers) : null;
}
