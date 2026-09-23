import { corsHeaders, resolveCreator } from './_auth';
import { listUserGames } from './_games';

interface Env {
  GITHUB_TOKEN: string;
  SESSIONS: KVNamespace;
  JWT_SECRET?: string;
}

const CONFIG = {
  org: 'freegamestore-online',
  adminProvision: 'https://admin.freegamestore.online/api/provision',
};

export const onRequestOptions: PagesFunction<Env> = async (ctx) =>
  new Response(null, { status: 204, headers: corsHeaders(ctx.request) });

/**
 * POST /api/publish — make a draft game live on the store.
 *
 * Under Path B, "publish" is the same idempotent provision as create: it ensures
 * the R2 host route + store registry entry exist for an already-created repo.
 * (The old version added a per-app CF Pages custom domain + DNS CNAME + registry
 * write by hand — Path A. That's gone; admin's handlePublish owns it now.)
 *
 * Guard: only a collaborator on the repo (its creator) may publish it, so this
 * can't be used to register a repo the caller doesn't own.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const user = await resolveCreator(context.request, context.env);
  const json = (v: unknown, status = 200) =>
    new Response(JSON.stringify(v), {
      status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(context.request) },
    });

  if (!user) return json({ error: 'Unauthorized' }, 401);

  let body: Record<string, string>;
  try {
    body = (await context.request.json()) as Record<string, string>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const id = body.id;
  if (!id) return json({ error: 'id required' }, 400);
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(id)) return json({ error: 'invalid id' }, 400);
  if (!body.name) return json({ error: 'name required' }, 400);

  // Ownership: the caller must OWN the game by registry `creatorGithub` (which
  // covers a pending-invite creator publishing their own just-created game) or
  // be an accepted collaborator (legacy). Registry-first avoids the 403-on-your-
  // own-game bug the collaborator-204-only check had.
  let owned: { id: string }[] = [];
  try {
    ({ owned } = await listUserGames(context.env, user));
  } catch (e) {
    // Registry outage: fall back to the collaborator check below (it doesn't
    // need the registry) rather than failing the publish outright.
    if ((e as Error).message !== 'registry_unavailable') throw e;
  }
  let allowed = owned.some((g) => g.id === id);
  if (!allowed) {
    const collabRes = await fetch(
      `https://api.github.com/repos/${CONFIG.org}/${id}/collaborators/${user}`,
      {
        headers: {
          Authorization: `Bearer ${context.env.GITHUB_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'freegamestore-publisher',
        },
      },
    );
    allowed = collabRes.status === 204;
  }
  if (!allowed) {
    return json({ error: "You don't have access to this game" }, 403);
  }

  // Forward to the canonical, idempotent provision. Admin authenticates from the
  // fgs_token cookie (shared .freegamestore.online domain); pin the owner.
  const cookie = context.request.headers.get('Cookie') ?? '';
  const provRes = await fetch(CONFIG.adminProvision, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      id,
      name: body.name,
      category: body.category,
      description: body.description,
      creatorGithub: user,
    }),
  });
  const provData = await provRes
    .json()
    .catch(() => ({ error: 'Provision returned a non-JSON response' }));
  return json(provData, provRes.status);
};
