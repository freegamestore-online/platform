// Same-site CSRF guard for the console's cookie-authenticated functions (#460).
//
// The console session is a `__Host-fgs_token` cookie with SameSite=Lax. Games
// are published on sibling subdomains (<game>.freegamestore.online), which are
// the SAME SITE as console.freegamestore.online, so SameSite does nothing
// against them: a game page can POST /auth/delete or /api/create with
// credentials:'include' and the browser attaches the creator's cookie. Browsers
// always send `Origin` on cross-origin and non-GET requests, so a state-changing
// request must come from a first-party origin — or, with no Origin at all, be
// same-origin by the browser's own account (Sec-Fetch-Site). A request with a
// body must also be JSON: a `text/plain` POST needs no CORS preflight, so it is
// exactly what a game would send blind. Mirrors the admin router's gate (#62).
//
// Files prefixed with `_` are not routed by Pages, so this is import-only.

// First-party origins ONLY. The old `*.freegamestore.online` wildcard reflected
// game subdomains too — and games are untrusted user content sharing the
// session cookie's registrable domain. The storefront is here because its
// analytics page PUTs /api/analytics/:id with the creator's cookie.
export const FIRST_PARTY_ORIGINS = new Set([
  'https://console.freegamestore.online',
  'https://freegamestore.online',
  'http://localhost:5173',
]);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function reject(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/**
 * Returns a 403/415 for a state-changing request that did not come from a
 * first-party page, or null when the handler may proceed. Call it first, before
 * reading the session cookie. Handlers that read the request body pass
 * `{ body: true }` to also require `Content-Type: application/json`; the
 * presence of a body can't be inferred (the Workers runtime hands a body-less
 * browser POST a non-null `request.body`, and such a POST carries no
 * Content-Type), so body-less handlers must not opt in.
 */
export function rejectCrossSite(request: Request, opts: { body?: boolean } = {}): Response | null {
  if (SAFE_METHODS.has(request.method)) return null;
  const origin = request.headers.get('Origin');
  const firstParty =
    origin === null
      ? request.headers.get('Sec-Fetch-Site') === 'same-origin'
      : FIRST_PARTY_ORIGINS.has(origin);
  if (!firstParty) return reject('forbidden origin', 403);
  if (
    opts.body &&
    request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json'
  ) {
    return reject('application/json required', 415);
  }
  return null;
}
