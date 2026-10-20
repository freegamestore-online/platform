import { resolveCaller } from '../caller';
import type { DataService, dataService } from '../data';
import type { Env } from '../env';
import { jsonResponse, safeEqual } from '../http';
import { agentProxyRoutes } from './agent-proxy';
import { ciRoutes } from './ci';
import { gamesRoutes } from './games';
import { opsRoutes } from './ops';
import { provisionRoutes } from './provision';
import type { Route } from './types';

/** Router dispatcher — matches incoming request against route table, handles auth,
 *  and calls appropriate handler. Returns null if no route matched. */
export async function dispatchApiRoute(
  request: Request,
  env: Env,
  data: ReturnType<typeof dataService>,
): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const method = request.method;

  // Build route table (defined below)
  const routes = buildRouteTable(data);

  // Find all routes that match the pathname pattern
  const matchedRoutes = routes.filter((route) => {
    if (typeof route.pattern === 'string') {
      return route.pattern === pathname;
    }
    return route.pattern.test(pathname);
  });

  if (matchedRoutes.length === 0) {
    // No route matched
    if (pathname.startsWith('/api/')) {
      return jsonResponse({ error: 'not found' }, 404, request);
    }
    return null; // Fall through to static handler
  }

  // Find routes that match both pathname AND method
  const matchedByMethod = matchedRoutes.filter((route) => {
    if (typeof route.method === 'string') {
      return route.method === method;
    }
    return route.method.includes(method);
  });

  if (matchedByMethod.length === 0) {
    // Path matched but not method
    if (pathname.startsWith('/api/')) {
      return jsonResponse({ error: 'method not allowed' }, 405, request);
    }
    return null;
  }

  // Use the first matching route
  const route = matchedByMethod[0]!;

  // Resolve caller credentials once per request
  const caller = await resolveCaller(request, env);

  // Check auth based on route's auth requirement
  if (route.auth === 'admin') {
    if (!caller.isAdmin) {
      return jsonResponse({ error: 'unauthorized' }, 401, request);
    }
  } else if (route.auth === 'login') {
    if (!caller.login) {
      return jsonResponse({ error: 'unauthorized' }, 401, request);
    }
  } else if (route.auth === 'internal') {
    const internal = request.headers.get('X-Internal-Token');
    if (!(internal && env.INTERNAL_TOKEN && safeEqual(internal, env.INTERNAL_TOKEN))) {
      return jsonResponse({ error: 'unauthorized' }, 401, request);
    }
  } else if (route.auth === 'ci') {
    const token = request.headers.get('X-CI-Token') || '';
    if (!(env.CI_TOKEN && safeEqual(token, env.CI_TOKEN))) {
      return jsonResponse({ error: 'unauthorized' }, 401, request);
    }
  }

  // Call handler
  const match = typeof route.pattern === 'string' ? null : pathname.match(route.pattern);

  try {
    return await route.handler({
      request,
      env,
      url,
      caller,
      match,
      data,
    });
  } catch (error) {
    console.error(`[route-error] ${method} ${pathname}:`, error);
    return jsonResponse({ error: String(error) }, 500, request);
  }
}

/** The declarative route table: each group lives in its own module. No two
 *  groups can match the same method and path, so their order doesn't change
 *  which handler answers. */
export function buildRouteTable(data: DataService): Route[] {
  return [
    ...opsRoutes(data),
    ...gamesRoutes(data),
    ...ciRoutes(data),
    ...agentProxyRoutes(data),
    ...provisionRoutes(data),
  ];
}
