import {
  declaresBody,
  rejectCrossSite,
  requireJsonBody,
} from '../../../contracts/cross-site/v1/contract';

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

/** `devOrigin` is the env's DEV_ORIGIN: local development only, unset in production (#486). */
export async function routeAdminRequest(
  request: Request,
  handlers: AdminRequestHandlers,
  devOrigin?: string,
): Promise<Response | null> {
  if (request.method === 'OPTIONS') return handlers.preflight(request);

  const path = new URL(request.url).pathname;
  if (!['GET', 'HEAD'].includes(request.method)) {
    const cookie = request.headers.get('Cookie') ?? '';
    // Match the credential precedence used by the authentication handlers.
    const usesCookie =
      /(?:^|;\s*)__Host-fgs_token=/.test(cookie) && !request.headers.get('X-FGS-Token');
    // /auth/handoff is POSTed by the auth worker's page, a different origin; the
    // handler itself requires that origin (#450).
    if (usesCookie && path !== '/auth/handoff') {
      const blocked = rejectCrossSite(request, {
        origins: ['https://admin.freegamestore.online'],
        devOrigin,
      });
      if (blocked) return blocked;
    }
    if (
      (path.startsWith('/api/') || path.startsWith('/v1/')) &&
      !(path === '/api/ci/test-report' && request.method === 'PUT')
    ) {
      // A body-less POST is fine; `request.body !== null` can't tell it apart from
      // one with a body (workerd 415'd every such call, #489).
      const blocked = declaresBody(request) ? requireJsonBody(request) : null;
      if (blocked) return blocked;
    }
  }
  if (path === '/auth/handoff' || path.startsWith('/v1/auth/')) return handlers.auth(request);

  // /docs is a rendered API resource even though it has no /api prefix.
  return path.startsWith('/api/') || path === '/docs'
    ? handlers.api(request)
    : handlers.static(request);
}
