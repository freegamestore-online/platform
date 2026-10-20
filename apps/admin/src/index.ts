import { routeAdminRequest } from './admin-request-router';
import { serveAdminStatic } from './admin-static';
import { authenticateAdmin, handleAdminAuthRoute, resolveCaller } from './caller';
import { dataService } from './data';
import type { Env } from './env';
import { pruneErrors } from './errlog';
import { reconcile } from './fleet';
import { corsHeaders } from './http';
import { docsPage, renderSignIn } from './pages';
import { dispatchApiRoute } from './routes/dispatch';

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // Hourly: heal provisioning drift, then prune the error log's old rows.
    ctx.waitUntil(reconcile(env, true));
    ctx.waitUntil(pruneErrors(env.DB));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const data = dataService(env);
    const transportResponse = await routeAdminRequest(request, {
      preflight: (req) => new Response(null, { status: 204, headers: corsHeaders(req) }),
      auth: (req) => handleAdminAuthRoute(req, env),
      // API routing below deliberately remains a separate data/lifecycle layer.
      api: async () => null,
      static: (req) =>
        serveAdminStatic(req, {
          authenticate: (staticRequest) => authenticateAdmin(staticRequest, env),
          renderSignIn,
          assets: env.ASSETS,
        }),
    });
    if (transportResponse) return transportResponse;

    // Route all requests through the declarative route table dispatcher.
    // Routes keep their own auth and are dispatched by pattern matching.
    const apiResponse = await dispatchApiRoute(request, env, data);
    if (apiResponse) return apiResponse;

    // dispatchApiRoute answers every /api/* path itself (404/405 when nothing
    // matches), so only non-API paths get here. The one with its own handling is
    // a non-GET /docs, which the GET-only route above doesn't take: admins get
    // the API docs page, everyone else the sign-in page. (The old per-route
    // copies of the /api handlers that used to sit here were unreachable and
    // were removed in #362.)
    if (url.pathname === '/docs') return docsPage(await resolveCaller(request, env));

    // Fallthrough (any unmatched path/method) also renders the console shell, so
    // it must be gated like "/" — otherwise GET /anything served the full,
    // indexable dashboard HTML to anyone (info disclosure; the /api/* it calls
    // still 401, but the shell shouldn't be world-readable). Non-admins get the
    // sign-in page.
    return serveAdminStatic(request, {
      authenticate: (staticRequest) => authenticateAdmin(staticRequest, env),
      renderSignIn,
      assets: env.ASSETS,
    });
  },
};
