import { corsHeaders, getCookie, resolveCreator, SESSION_COOKIE } from './_auth';
import { fetchWithTimeout, recordError } from './_errlog';
import { listUserGames } from './_games';
// Single source of truth shared with check-id.ts so the create gate and the
// availability check can never disagree on which ids are valid. Re-exported to
// preserve create.ts's existing public surface.
import { validateId } from './_validate';

export { validateId };

interface Env {
  GITHUB_TOKEN: string;
  MAX_APPS_PER_USER: string;
  CREATORS: KVNamespace;
  SESSIONS: KVNamespace;
  JWT_SECRET?: string;
  /** Admin's "fas" D1 — for durable error/crash logging (see _errlog.ts). */
  DB?: D1Database;
}

export const onRequestOptions: PagesFunction<Env> = async (ctx) =>
  new Response(null, { status: 204, headers: corsHeaders(ctx.request) });

const CONFIG = {
  org: 'freegamestore-online',
  // The canonical provision endpoint. ONE code path creates every game (repo +
  // R2 host route + registry entry + collaborator), idempotently, on Path B.
  // The Dashboard used to hand-roll a per-app CF Pages project here — that was
  // Path A (100-project cap), never wrote a registry entry (so drafts vanished
  // from the dashboard), and duplicated the GitHub/CF tokens. All of that now
  // lives in admin's handlePublish; this endpoint just authorizes + forwards.
  adminProvision: 'https://admin.freegamestore.online/api/provision',
};

const gh = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'freegamestore-publisher',
});

function isProductionCreateCanary(user: string, id: string): boolean {
  // The production create canary uses the platform owner token, which already
  // owns more than the normal creator quota. Keep the bypass extremely narrow:
  // hidden fixture IDs only, owner only. The store build excludes *-test IDs
  // from the public catalog, and the canary deletes the game immediately after
  // verifying the host.
  return user.toLowerCase() === 'serge-ivo' && /^e2e-create-[a-z0-9-]+-test$/.test(id);
}

/**
 * POST /api/create — provision a new game via the canonical admin path (Path B).
 * Creates the repo from the chosen template, writes the R2 host route + store
 * registry entry, and grants the creator push access — all idempotently. The
 * game is live at <id>.freegamestore.online and appears on the dashboard
 * immediately (registry entry). No CF Pages project is created.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  // --- instrumentation only (does not change provisioning behavior) ---
  const t0 = Date.now();
  const rid = crypto.randomUUID().slice(0, 8);
  const log = (m: string) => console.log(`[create ${rid} +${Date.now() - t0}ms] ${m}`);
  const json = (v: unknown, status = 200) =>
    new Response(JSON.stringify(v), {
      status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(context.request) },
    });

  let userForLog: string | undefined;
  let idForLog: string | undefined;
  try {
    log('start');
    const user = await resolveCreator(context.request, context.env);
    userForLog = user ?? undefined;
    log(`auth: ${user ?? 'unauthenticated'}`);
    if (!user) return json({ error: 'Unauthorized' }, 401);

    // Reject suspended creators (api/me.ts surfaces `banned`; create must honor it too).
    const kvRaw = await context.env.CREATORS.get(user);
    if (kvRaw) {
      try {
        if ((JSON.parse(kvRaw) as { banned?: boolean }).banned)
          return json({ error: 'Account suspended' }, 403);
      } catch {
        /* ignore malformed record */
      }
    }

    let body: Record<string, string>;
    try {
      body = (await context.request.json()) as Record<string, string>;
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }
    // Normalize before validating so a non-UI client can't get "available" from
    // check-id (which trims+lowercases) yet a 400 here.
    body.id = (body.id ?? '').trim().toLowerCase();
    idForLog = body.id;
    log(`body id=${body.id} name=${JSON.stringify(body.name)} template=${body.template}`);
    const idErr = validateId(body.id);
    if (idErr) return json({ error: idErr }, 400);
    if (!body.name) return json({ error: 'name required' }, 400);

    // Ownership + per-creator limit, both from the SAME registry-primary `owned`
    // list that /api/me uses — so the slot count shown on the dashboard and the
    // create gate can never disagree.
    let owned: { id: string }[] = [];
    try {
      ({ owned } = await listUserGames(context.env, user));
      log(`listUserGames ok: ${owned.length} owned`);
    } catch (e) {
      // Don't fall through to the ownership/limit checks on a registry outage —
      // owned would be empty and a re-provision of the user's own game would
      // wrongly 409 "already exists". Ask them to retry.
      if ((e as Error).message === 'registry_unavailable') {
        return json(
          { error: 'The game registry is temporarily unavailable. Please retry in a moment.' },
          503,
        );
      }
      throw e;
    }
    log('github repo-existence check');
    const repoCheck = await fetchWithTimeout(
      `https://api.github.com/repos/${CONFIG.org}/${body.id}`,
      { headers: gh(context.env.GITHUB_TOKEN) },
      15000,
      'github repo check',
    );
    // Fail SAFE: only a 200 means "exists" and only a 404 means "free". A 401
    // (token expiry), 403 (rate limit), or 5xx must NOT be read as "free" — that
    // would skip the duplicate/ownership guard and provision over another game.
    if (repoCheck.status !== 200 && repoCheck.status !== 404) {
      log(`github repo check inconclusive: status=${repoCheck.status}`);
      return json(
        { error: "Couldn't verify the game id right now. Please retry in a moment." },
        502,
      );
    }
    const repoExisted = repoCheck.status === 200;
    log(`github repo check: status=${repoCheck.status} existed=${repoExisted}`);
    if (repoExisted && !owned.some((g) => g.id === body.id)) {
      // The repo exists and isn't one of this user's games — don't let them
      // re-provision (and re-own) someone else's game.
      return json({ error: 'A game with this id already exists' }, 409);
    }
    if (!repoExisted) {
      const max = parseInt(context.env.MAX_APPS_PER_USER || '10', 10);
      if (owned.length >= max && !isProductionCreateCanary(user, body.id)) {
        return json({ error: `Game limit reached (${max} per creator)` }, 403);
      }
    }

    // The browser's console cookie is host-only. Forward the already-authenticated
    // session explicitly server-to-server; admin never relies on a broad cookie.
    const token = getCookie(context.request, SESSION_COOKIE) ?? '';
    log('admin provision: POST (up to 90s)');
    const provRes = await fetchWithTimeout(
      CONFIG.adminProvision,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-FGS-Token': token },
        body: JSON.stringify({
          id: body.id,
          name: body.name,
          category: body.category,
          icon: body.icon,
          iconBg: body.iconBg,
          description: body.description,
          template: body.template,
          cloneFrom: body.cloneFrom,
          creatorGithub: user,
        }),
      },
      90000,
      'admin provision',
    );
    const provText = await provRes.text();
    log(`admin provision: status=${provRes.status} bodyLen=${provText.length}`);
    let provData: unknown;
    try {
      provData = JSON.parse(provText);
    } catch {
      provData = { error: 'Provision returned a non-JSON response' };
    }
    // Persist an admin-reported failure so it also shows on the console (this is
    // logging only — the response returned to the caller is unchanged).
    const failed =
      !provRes.ok ||
      !!(provData as { error?: string })?.error ||
      (provData as { success?: boolean })?.success === false;
    if (failed) {
      await recordError(context.env.DB, {
        source: 'api/create',
        user,
        context: `admin provision id=${body.id} status=${provRes.status}`,
        message:
          (provData as { error?: string })?.error ||
          `admin provision returned HTTP ${provRes.status}`,
        stack: provText.slice(0, 1000),
      });
    } else {
      log('success');
    }
    return json(provData, provRes.status);
  } catch (e) {
    // Any throw / timeout below is now VISIBLE: logged to Workers Logs AND the
    // error_log table (admin console), and returned to the caller as a real
    // message instead of an opaque "Load failed".
    const err = e as Error;
    log(`THREW: ${err?.message ?? String(e)}`);
    await recordError(context.env.DB, {
      source: 'api/create',
      user: userForLog,
      context: `id=${idForLog} failedAfter=${Date.now() - t0}ms`,
      message: err?.message ?? String(e),
      stack: err?.stack,
    });
    return json({ error: `Create failed: ${err?.message ?? String(e)}` }, 500);
  }
};
