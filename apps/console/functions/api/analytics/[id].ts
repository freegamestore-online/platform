import { corsHeaders, getCookie, resolveCreator, SESSION_COOKIE } from '../_auth';
import { validateId } from '../_validate';

interface Env {
  SESSIONS: KVNamespace;
  JWT_SECRET?: string;
}

// Owner analytics for one game (#354). The stats query and the ownership check
// live on the admin worker, which holds the registry and the Analytics Engine
// token. Admin sits behind CF Access, so this Pages Function authorizes the
// signed-in creator and forwards the cookie server-side, the same pattern as
// /api/games/:id.
const ADMIN_GAMES = 'https://admin.freegamestore.online/api/games';

export const onRequestOptions: PagesFunction<Env> = async (ctx) =>
  new Response(null, { status: 204, headers: corsHeaders(ctx.request) });

async function proxy(
  context: Parameters<PagesFunction<Env>>[0],
  method: 'GET' | 'PUT',
): Promise<Response> {
  const json = (v: unknown, status = 200) =>
    new Response(JSON.stringify(v), {
      status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(context.request) },
    });

  const user = await resolveCreator(context.request, context.env);
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const id = String(context.params.id ?? '');
  const idError = validateId(id);
  if (idError) return json({ error: idError }, 400);

  const init: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-FGS-Token': getCookie(context.request, SESSION_COOKIE) ?? '',
    },
  };
  if (method === 'PUT') init.body = await context.request.text();
  // GET carries its window and filters (?days=, ?kind=, ?path=, ?bucket=) through.
  const search = method === 'GET' ? new URL(context.request.url).search : '';

  let res: Response;
  try {
    res = await fetch(`${ADMIN_GAMES}/${id}/analytics${search}`, init);
  } catch (e) {
    return json(
      { error: `Couldn't reach the game service: ${e instanceof Error ? e.message : String(e)}` },
      502,
    );
  }
  const data = await res.json().catch(() => ({ error: 'Admin returned a non-JSON response' }));
  return json(data, res.status);
}

/** GET /api/analytics/:id — owner-only stats and the BYO tag config. */
export const onRequestGet: PagesFunction<Env> = (ctx) => proxy(ctx, 'GET');

/** PUT /api/analytics/:id — owner-only BYO tags (GA4, Plausible). */
export const onRequestPut: PagesFunction<Env> = (ctx) => proxy(ctx, 'PUT');
