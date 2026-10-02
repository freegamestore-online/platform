/**
 * Transport-only admin router.  It intentionally knows no registry, D1, GitHub,
 * or reconciliation details: those remain behind the injected API handler.
 */
export interface AdminRequestHandlers {
  preflight(request: Request): Response;
  auth(request: Request): Promise<Response | null>;
  /** Return null to let the API domain handler continue its route matching. */
  api(request: Request): Promise<Response | null>;
  static(request: Request): Promise<Response | null>;
}

export async function routeAdminRequest(
  request: Request,
  handlers: AdminRequestHandlers,
): Promise<Response | null> {
  if (request.method === 'OPTIONS') return handlers.preflight(request);

  const path = new URL(request.url).pathname;
  if (!['GET', 'HEAD'].includes(request.method)) {
    const cookie = request.headers.get('Cookie') ?? '';
    // Match the credential precedence used by the authentication handlers.
    const usesCookie =
      /(?:^|;\s*)__Host-fgs_token=/.test(cookie) && !request.headers.get('X-FGS-Token');
    const origin = request.headers.get('Origin');
    const allowedOrigin =
      origin === 'https://admin.freegamestore.online' || origin === 'http://localhost:5173';
    if (
      usesCookie &&
      !allowedOrigin &&
      (origin !== null || request.headers.get('Sec-Fetch-Site') !== 'same-origin')
    ) {
      return Response.json({ error: 'forbidden origin' }, { status: 403 });
    }
    if (
      (path.startsWith('/api/') || path.startsWith('/v1/')) &&
      !(path === '/api/ci/test-report' && request.method === 'PUT') &&
      request.body !== null &&
      request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() !==
        'application/json'
    ) {
      return Response.json({ error: 'application/json required' }, { status: 415 });
    }
  }
  if (path === '/auth/handoff' || path.startsWith('/v1/auth/')) return handlers.auth(request);

  // /docs is a rendered API resource even though it has no /api prefix.
  return path.startsWith('/api/') || path === '/docs'
    ? handlers.api(request)
    : handlers.static(request);
}
