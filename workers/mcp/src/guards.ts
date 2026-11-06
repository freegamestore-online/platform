// Request guards in front of the OAuth provider and the MCP transport (#445).
//
// The provider only checks /token, /register and authenticated tool calls, so
// everything here runs first, for every request:
//  - a per-IP request limit, and a much tighter one on dynamic client
//    registration (an unauthenticated write to KV);
//  - a body-size bound, counted as it streams, so a missing or false
//    Content-Length can't get past it;
//  - an Origin policy: the MCP transport spec asks servers to validate Origin, and
//    the provider's CORS handling otherwise echoes any origin back.
//
// Free functions over Request/Response so test/guards.test.mjs can drive them
// without the Workers runtime. FGS-only; written for this worker.

/** Workers Rate Limiting binding. */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** Must match `simple.period` of the bindings in wrangler.toml. */
export const RATE_LIMIT_PERIOD_SECONDS = 60;
export const MAX_REQUEST_BODY_BYTES = 1024 * 1024;

export interface GuardEnv {
  /** 120 requests / 60 s / IP, every route. */
  MCP_RATE_LIMIT?: RateLimiter;
  /** 10 requests / 60 s / IP, POST /register only. */
  MCP_REGISTER_LIMIT?: RateLimiter;
}

type Handler<E> = (request: Request, env: E, ctx: ExecutionContext) => Promise<Response> | Response;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

export function withRateLimits<E extends GuardEnv>(next: Handler<E>): Handler<E> {
  return async (request, env, ctx) => {
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    const limits: [RateLimiter | undefined, string][] = [[env.MCP_RATE_LIMIT, `mcp:${ip}`]];
    if (request.method === 'POST' && new URL(request.url).pathname === '/register') {
      limits.push([env.MCP_REGISTER_LIMIT, `mcp-register:${ip}`]);
    }
    for (const [limiter, key] of limits) {
      // Unbound in `wrangler dev` and tests: no limit.
      if (limiter && !(await limiter.limit({ key })).success) {
        return json(
          429,
          { error: 'rate_limited', error_description: 'Too many requests' },
          { 'Retry-After': String(RATE_LIMIT_PERIOD_SECONDS) },
        );
      }
    }
    return next(request, env, ctx);
  };
}

export function withBoundedBody<E>(next: Handler<E>): Handler<E> {
  return async (request, env, ctx) => {
    if (!request.body) return next(request, env, ctx);
    const tooLarge = () => new Response('Request too large.', { status: 413 });
    const declared = request.headers.get('content-length');
    if (declared && /^\d+$/.test(declared) && Number(declared) > MAX_REQUEST_BODY_BYTES) {
      await request.body.cancel();
      return tooLarge();
    }
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_REQUEST_BODY_BYTES) {
          await reader.cancel();
          return tooLarge();
        }
        chunks.push(value);
      }
    } catch {
      return new Response('Could not read request body.', { status: 400 });
    } finally {
      reader.releaseLock();
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.length;
    }
    const headers = new Headers(request.headers);
    headers.delete('content-length');
    return next(new Request(request, { body, headers }), env, ctx);
  };
}

/** Browser origins that may call the MCP: the store's own pages, Claude on the
 *  web, and a local MCP client (any port on a loopback host). */
const ALLOWED_ORIGINS = new Set([
  'https://freegamestore.online',
  'https://console.freegamestore.online',
  'https://claude.ai',
]);

export function isAllowedOrigin(origin: string): boolean {
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const u = new URL(origin);
    return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  } catch {
    return false;
  }
}

/**
 * A request with no Origin (a native client) is untouched. A listed Origin passes
 * as before. An unlisted one gets a 403 on its preflight, and the CORS headers are
 * stripped from every other answer so the browser won't hand the body to the page.
 */
export function withOriginPolicy<E>(next: Handler<E>): Handler<E> {
  return async (request, env, ctx) => {
    const origin = request.headers.get('Origin');
    if (origin === null || isAllowedOrigin(origin)) return next(request, env, ctx);
    if (request.method === 'OPTIONS') return json(403, { error: 'origin_not_allowed' });
    const res = await next(request, env, ctx);
    const headers = new Headers(res.headers);
    for (const name of [...headers.keys()]) {
      if (name.toLowerCase().startsWith('access-control-')) headers.delete(name);
    }
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  };
}
