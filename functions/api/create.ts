import { resolveCreator, corsHeaders } from "./_auth";
import { listUserGames } from "./_games";

interface Env {
  GITHUB_TOKEN: string;
  MAX_APPS_PER_USER: string;
  CREATORS: KVNamespace;
  SESSIONS: KVNamespace;
  JWT_SECRET?: string;
}

export const onRequestOptions: PagesFunction<Env> = async (ctx) =>
  new Response(null, { status: 204, headers: corsHeaders(ctx.request) });

const CONFIG = {
  org: "freegamestore-online",
  // The canonical provision endpoint. ONE code path creates every game (repo +
  // R2 host route + registry entry + collaborator), idempotently, on Path B.
  // The Dashboard used to hand-roll a per-app CF Pages project here — that was
  // Path A (100-project cap), never wrote a registry entry (so drafts vanished
  // from the dashboard), and duplicated the GitHub/CF tokens. All of that now
  // lives in admin's handlePublish; this endpoint just authorizes + forwards.
  adminProvision: "https://admin.freegamestore.online/api/provision",
};

// Reserved / infrastructure repos that must never be targetable via /api/create.
const INFRA_REPOS = new Set([
  "freegamestore", "submissions", "template-game-canvas", "template-game-3d",
  "template-game-grid", "template-game-cards", "brand", "ops", "sdk",
]);

function validateId(id: string): string | null {
  if (!id) return "ID is required";
  if (id.length > 58) return "ID must be 58 characters or less";
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(id)) return "Lowercase letters, numbers, dashes only. No start/end dash.";
  if (id.startsWith("free") || id.startsWith("pro")) return "Cannot start with 'free' or 'pro'";
  if (INFRA_REPOS.has(id)) return "Reserved id";
  return null;
}

const gh = (token: string) => ({
  Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "freegamestore-publisher",
});

/**
 * POST /api/create — provision a new game via the canonical admin path (Path B).
 * Creates the repo from the chosen template, writes the R2 host route + store
 * registry entry, and grants the creator push access — all idempotently. The
 * game is live at <id>.freegamestore.online and appears on the dashboard
 * immediately (registry entry). No CF Pages project is created.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const user = await resolveCreator(context.request, context.env);
  const json = (v: unknown, status = 200) =>
    new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json", ...corsHeaders(context.request) } });

  if (!user) return json({ error: "Unauthorized" }, 401);

  // Reject suspended creators (api/me.ts surfaces `banned`; create must honor it too).
  const kvRaw = await context.env.CREATORS.get(user);
  if (kvRaw) {
    try { if ((JSON.parse(kvRaw) as { banned?: boolean }).banned) return json({ error: "Account suspended" }, 403); }
    catch { /* ignore malformed record */ }
  }

  let body: Record<string, string>;
  try {
    body = await context.request.json() as Record<string, string>;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const idErr = validateId(body.id);
  if (idErr) return json({ error: idErr }, 400);
  if (!body.name) return json({ error: "name required" }, 400);

  // Ownership + per-creator limit, both from the SAME registry-primary `owned`
  // list that /api/me uses — so the slot count shown on the dashboard and the
  // create gate can never disagree.
  let owned: { id: string }[] = [];
  try {
    ({ owned } = await listUserGames(context.env, user));
  } catch (e) {
    // Don't fall through to the ownership/limit checks on a registry outage —
    // owned would be empty and a re-provision of the user's own game would
    // wrongly 409 "already exists". Ask them to retry.
    if ((e as Error).message === "registry_unavailable") {
      return json({ error: "The game registry is temporarily unavailable. Please retry in a moment." }, 503);
    }
    throw e;
  }
  const repoCheck = await fetch(`https://api.github.com/repos/${CONFIG.org}/${body.id}`, { headers: gh(context.env.GITHUB_TOKEN) });
  const repoExisted = !!((await repoCheck.json()) as Record<string, unknown>).id;
  if (repoExisted && !owned.some((g) => g.id === body.id)) {
    // The repo exists and isn't one of this user's games — don't let them
    // re-provision (and re-own) someone else's game.
    return json({ error: "A game with this id already exists" }, 409);
  }
  if (!repoExisted) {
    const max = parseInt(context.env.MAX_APPS_PER_USER || "10", 10);
    if (owned.length >= max) {
      return json({ error: `Game limit reached (${max} per creator)` }, 403);
    }
  }

  // Forward to the canonical provision endpoint. Admin authenticates the caller
  // from the fgs_token cookie (Domain=.freegamestore.online — shared with this
  // Pages host), so we pass the incoming Cookie through and pin creatorGithub to
  // the resolved user so the registry records the right owner.
  const cookie = context.request.headers.get("Cookie") ?? "";
  const provRes = await fetch(CONFIG.adminProvision, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Cookie": cookie },
    body: JSON.stringify({
      id: body.id,
      name: body.name,
      category: body.category,
      icon: body.icon,
      iconBg: body.iconBg,
      description: body.description,
      template: body.template,
      creatorGithub: user,
    }),
  });
  const provData = await provRes.json().catch(() => ({ error: "Provision returned a non-JSON response" }));
  return json(provData, provRes.status);
};
