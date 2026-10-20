/** Length-checked constant-time-ish string compare for the internal token. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// STRICT allowlist — the admin API must NOT reflect arbitrary game subdomains.
// Games are untrusted content; with credentialed CORS, a malicious game the
// admin opens could read /api/errors + /api/users (its cookie is sent) or CSRF
// provision/delete. The admin console is served same-origin from here, and the
// creator publish flow reaches this worker server-to-server (no browser Origin),
// so no *.freegamestore.online game origin ever needs cross-origin access.
export const CORS_ORIGINS = new Set([
  'https://admin.freegamestore.online',
  'http://localhost:5173',
]);

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin') ?? '';
  const allowed = CORS_ORIGINS.has(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? origin : '',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
  };
}

export function jsonResponse(data: unknown, status: number, request: Request): Response {
  return new Response(JSON.stringify(data), {
    status,
    // no-store: these carry per-admin / observability data — the edge must never
    // cache them (a stale public copy is exactly how the creator list + crash
    // log leaked before the gate landed).
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...corsHeaders(request),
    },
  });
}
