import { corsHeaders, resolveCreator } from './_auth';
import { recordError } from './_errlog';

interface Env {
  SESSIONS: KVNamespace;
  JWT_SECRET?: string;
  /** Admin's "freegamestore" D1 — for durable error/crash logging. */
  DB?: D1Database;
}

// Per-IP in-memory rate limit: max 20 reports per minute.
// In-memory only (resets on restart), but good enough to prevent accidental
// flooding from a render-loop triggering onerror.
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  let bucket = rateLimitBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateLimitBuckets.set(ip, bucket);
  }
  bucket.count++;
  return bucket.count > RATE_LIMIT;
}

export const onRequestOptions: PagesFunction<Env> = async (ctx) =>
  new Response(null, { status: 204, headers: corsHeaders(ctx.request) });

/**
 * POST /api/client-error — accept a client-side error report and insert it
 * into the shared error_log D1 table. Identity is resolved server-side from
 * the signed-in session; any client-supplied identity field is ignored.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const json = (v: unknown, status = 200) =>
    new Response(JSON.stringify(v), {
      status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
    });

  // Rate-limit by CF-connecting IP (best effort; CF always sets this header).
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (isRateLimited(ip)) {
    return json({ error: 'Too many error reports' }, 429);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  // Cap all string fields before insert — message/stack can be large.
  const MAX_MESSAGE = 2_000;
  const MAX_STACK = 4_000;
  const MAX_CONTEXT = 1_000;

  const route = typeof body.route === 'string' ? body.route.slice(0, 200) : null;
  const message =
    typeof body.message === 'string' ? body.message.slice(0, MAX_MESSAGE) : 'unknown error';
  const stack = typeof body.stack === 'string' ? body.stack.slice(0, MAX_STACK) || null : null;
  const clientContext =
    typeof body.context === 'string' ? body.context.slice(0, MAX_CONTEXT) : null;

  // Resolve the signed-in GitHub login server-side — never trust the client.
  const userLogin = await resolveCreator(request, env);

  const context_str =
    [route ? `route=${route}` : null, clientContext].filter(Boolean).join(' ') || null;

  await recordError(env.DB, {
    source: 'console/web',
    user: userLogin,
    context: context_str,
    message,
    stack,
  });

  return json({ ok: true });
};
