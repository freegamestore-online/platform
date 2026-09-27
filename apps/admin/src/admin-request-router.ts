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
  if (path === '/auth/handoff' || path.startsWith('/v1/auth/')) return handlers.auth(request);

  // /docs is a rendered API resource even though it has no /api prefix.
  return path.startsWith('/api/') || path === '/docs'
    ? handlers.api(request)
    : handlers.static(request);
}
