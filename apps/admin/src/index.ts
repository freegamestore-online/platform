import { handleDeleteGame, handlePublish, handleUpdateGame, insertHostRoute, readGameStatus, setGameStatus, setGameStatuses, type GameStatus } from "./publish";
import { errorStats, listErrors, pruneErrors, recordError } from "./errlog";
import { driftReportFrom, findDrift, recentRuns, sweepFleet, type FleetRow } from "./drift";
import { verifySession, handleAuthExchange, handleAuthMe } from "./auth";
import { renderApiDocs } from "./dashboard";

interface Env {
  CF_ACCOUNT_ID: string;
  CF_API_TOKEN: string;
  GITHUB_TOKEN: string;
  /** This admin's OWN HS256 signing key — it mints + verifies its own
   *  sessions via /v1/auth/exchange (not shared with FAS). */
  SESSION_SIGNING_KEY: string;
  /** FGS-owned `freegamestore` D1 — fgs/host reads from this same table. */
  DB: D1Database;
  /** Service binding to the auth worker (verify fgs_token via /me). */
  AUTH: Fetcher;
  /** Service binding to the agent worker — used to proxy complimentary-grant
   *  admin calls to the vault DB it owns (authenticated by INTERNAL_TOKEN). */
  AGENT?: Fetcher;
  /** Workers Static Assets — the built React admin app in public/. */
  ASSETS?: Fetcher;
  /** Shared secret for trusted worker-to-worker provision calls (the agent has
   *  no user fgs_token at deploy time). Presented as X-Internal-Token. */
  INTERNAL_TOKEN?: string;
  /** Comma-separated allowlist of admin emails. The console UI + every
   *  observability endpoint are restricted to these (verified Google emails
   *  resolved via the auth worker's /me). Falls back to the sole owner. */
  ADMIN_EMAILS?: string;
}

/** Length-checked constant-time-ish string compare for the internal token. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The admin allowlist (verified Google emails). Defaults to the sole owner so
 *  the console is never accidentally left open if the var is unset. */
function adminEmails(env: Env): string[] {
  return (env.ADMIN_EMAILS || "serge.the.dev@gmail.com")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Resolve the signed-in user's verified email via the auth worker, and whether
 *  they're an admin. Returns `email: null` when not signed in at all (so the
 *  sign-in page can tell "sign in" from "wrong account"). */
async function authenticateAdmin(request: Request, env: Env): Promise<{ email: string | null; isAdmin: boolean }> {
  const authz = request.headers.get("Authorization") ?? "";
  const bearer = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
  const cookie = request.headers.get("Cookie") ?? "";
  const fgsToken = request.headers.get("X-FGS-Token") || cookie.match(/fgs_token=([^;]*)/)?.[1] || bearer;
  if (!fgsToken) return { email: null, isAdmin: false };
  try {
    // X-FGS-Token so /me returns the email (it withholds it on other paths).
    const meRes = await env.AUTH.fetch("https://auth.freegamestore.online/me", {
      headers: { "X-FGS-Token": fgsToken },
    });
    if (!meRes.ok) return { email: null, isAdmin: false };
    const user = (await meRes.json()) as { email?: string | null };
    const email = user.email ? user.email.toLowerCase() : null;
    return { email, isAdmin: !!email && adminEmails(env).includes(email) };
  } catch {
    return { email: null, isAdmin: false };
  }
}

/** Sign-in / not-authorized page for the console. `signedInAs` distinguishes a
 *  fresh visitor (null → "sign in") from a signed-in non-admin (→ "wrong
 *  account, switch"). Google login, `prompt=select_account`, redirects back. */
function renderSignIn(signedInAs: string | null): string {
  // /login/google — NOT /login (that route is GitHub, which yields no email and
  // can never match the admin allowlist). Google carries the verified email.
  const loginUrl = "https://auth.freegamestore.online/login/google?redirect=" + encodeURIComponent("https://admin.freegamestore.online/");
  const wrong = signedInAs
    ? `<p class="note">Signed in as <strong>${escapeHtml(signedInAs)}</strong> — that account isn't an admin.</p>`
    : `<p class="note">This console is restricted to the store administrator.</p>`;
  const cta = signedInAs ? "Use a different account" : "Sign in with Google";
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Sign in — FreeGameStore Admin</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100dvh; display:flex; align-items:center; justify-content:center; padding:1.5rem;
    background:#0d0f0e; color:#e5e5e5; font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif; }
  .card { width:100%; max-width:380px; background:#141715; border:1px solid #262a27; border-radius:16px;
    padding:2.25rem 2rem; text-align:center; }
  .mark { font-family:Fraunces,Georgia,serif; font-weight:800; font-size:1.35rem; letter-spacing:-0.02em; margin-bottom:0.35rem; }
  .mark span { color:#34d399; }
  .sub { color:#8b938d; font-size:0.8rem; margin:0 0 1.6rem; text-transform:uppercase; letter-spacing:0.12em; }
  .note { color:#a8b0aa; font-size:0.9rem; line-height:1.5; margin:0 0 1.6rem; }
  .btn { display:inline-flex; align-items:center; justify-content:center; gap:0.5rem; width:100%;
    background:#34d399; color:#04140d; font-weight:700; font-size:0.95rem; text-decoration:none;
    padding:0.8rem 1rem; border-radius:10px; }
  .btn:hover { background:#2dd4a7; }
</style></head>
<body><main class="card">
  <div class="mark">Free<span>Game</span>Store</div>
  <p class="sub">Admin</p>
  ${wrong}
  <a class="btn" href="${loginUrl}">${cta}</a>
</main></body></html>`;
}

/** Minimal HTML-escape for values interpolated into the sign-in page. */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

/** Extract the authenticated GitHub login from either credential the platform issues:
 *  1. Bearer admin session token (CLI `fgs login`)
 *  2. fgs_token — as an Authorization Bearer (MCP) OR an fgs_token cookie (console),
 *     verified by the auth worker's /me (single uniform identity, like the other stores). */
async function authenticateLogin(request: Request, env: Env): Promise<string | null> {
  const auth = request.headers.get("Authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";

  // 1. Admin-minted session token (CLI).
  if (bearer) {
    const login = await verifySession(bearer, env.SESSION_SIGNING_KEY);
    if (login) return login;
  }

  // 2. fgs_token — via X-FGS-Token (MCP, worker-to-worker), cookie (console),
  //    or the Bearer fallback. The auth worker's /me verifies the signature.
  const cookie = request.headers.get("Cookie") ?? "";
  const fgsToken = request.headers.get("X-FGS-Token") || cookie.match(/fgs_token=([^;]*)/)?.[1] || bearer;
  if (fgsToken) {
    try {
      // Service binding (not a public-hostname fetch — that loops back, CF 522).
      const meRes = await env.AUTH.fetch("https://auth.freegamestore.online/me", {
        headers: { "X-FGS-Token": fgsToken },
      });
      if (meRes.ok) {
        const user = await meRes.json() as { id?: string };
        const parts = fgsToken.split(".");
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1]!.replace(/-/g, "+").replace(/_/g, "/"))) as { login?: string; sub?: string };
          return payload.login ?? payload.sub ?? null;
        }
        return user.id ?? null;
      }
    } catch { /* fall through */ }
  }
  return null;
}

interface GameConfig {
  id: string;
  name: string;
  org: string;
  cfProject: string;
  domain: string;
  hostedOn: string;
  /** Build lifecycle (#22). Always concrete here — readGameStatus resolves a
   *  missing/unrecognised registry value to "live", so the console never has to
   *  decide what an absent status means. */
  status: GameStatus;
}

interface QualityGame {
  id: string;
  score: number;
  loadTimeMs: number;
  consoleErrors: string[];
}

interface QualityData {
  timestamp: string;
  games: QualityGame[];
}

const REGISTRY_URL = "https://raw.githubusercontent.com/freegamestore-online/freegamestore/main/registry.json";
const QUALITY_URL = "https://raw.githubusercontent.com/freegamestore-online/freegamestore/main/data/quality-results.json";
const ORG = "freegamestore-online";
const DOMAIN = "freegamestore.online";

/** Fetch raw registry items (source of truth for games).
 *  Prefers the authenticated GitHub contents API — which is NOT CDN-cached, so a
 *  game provisioned/edited seconds ago appears immediately (admin already holds
 *  GITHUB_TOKEN) — and falls back to the raw.githubusercontent.com CDN URL
 *  (cached ~5min) only when there is no token or the API call fails.
 *
 *  Returns `null` when EVERY attempt failed — which is NOT the same as an empty
 *  registry. A fetch failure must not read as "zero games": in reconcile() that
 *  turns every live route into false orphan drift (and, once reconcile heals,
 *  would delete every route). `[]` means the registry loaded and is genuinely
 *  empty; callers that just render tolerate `?? []`. */
async function fetchRegistryItems(env: Env): Promise<any[] | null> {
  if (env.GITHUB_TOKEN) {
    try {
      const res = await fetch(
        `https://api.github.com/repos/${ORG}/freegamestore/contents/registry.json`,
        {
          headers: {
            Authorization: `Bearer ${env.GITHUB_TOKEN}`,
            Accept: "application/vnd.github.raw+json",
            "User-Agent": "freegamestore-admin",
          },
        },
      );
      if (res.ok) {
        const data = (await res.json()) as any;
        return data.games || [];
      }
    } catch {
      /* fall through to the raw CDN URL */
    }
  }
  try {
    const res = await fetch(REGISTRY_URL, { headers: { "User-Agent": "freegamestore-admin" } });
    if (res.ok) {
      const data = (await res.json()) as any;
      return data.games || [];
    }
  } catch {
    /* both attempts failed */
  }
  return null;
}

async function fetchRegistry(env: Env): Promise<GameConfig[]> {
  const items = (await fetchRegistryItems(env)) ?? [];
  return items.map((item: any) => ({
    id: item.id,
    name: item.name,
    org: ORG,
    cfProject: item.cfProject || `free${item.id}app`,
    domain: `${item.id}.${DOMAIN}`,
    hostedOn: item.hostedOn || "pages",
    status: readGameStatus(item),
  }));
}

/** Raw registry items (keeps fields fetchRegistry() drops, e.g. creatorGithub)
 *  — backs the Users tab + creator stats. A fetch failure renders as empty here
 *  (best-effort read path); reconcile() uses fetchRegistryItems() directly so it
 *  can distinguish failure from empty. */
async function fetchRegistryRaw(env: Env): Promise<any[]> {
  return (await fetchRegistryItems(env)) ?? [];
}

async function fetchQuality(): Promise<QualityData | null> {
  try {
    const res = await fetch(QUALITY_URL, { headers: { "User-Agent": "freegamestore-admin" } });
    if (!res.ok) return null;
    return await res.json() as QualityData;
  } catch {
    return null;
  }
}

async function fetchGameStatus(game: GameConfig, env: Env) {
  // Path B (R2) games have no CF Pages project — querying one always 404s and
  // reports a bogus "no_project" error. Every current FGS game is on Path B,
  // so without this short-circuit the whole dashboard reads as broken.
  if (game.hostedOn === "r2") {
    return {
      cf: {
        deploy: { status: "r2", time: null, url: `https://${game.domain}`, error: null },
        domain: { status: "active", cert: "active", error: null },
        source: null,
      },
    };
  }
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/pages/projects/${game.cfProject}`,
      { headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` } }
    );
    const data = await res.json() as any;

    if (!data.success) {
      return {
        cf: {
          deploy: { status: "no_project", time: null, url: null, error: `Project "${game.cfProject}" not found` },
          domain: { status: "unknown", cert: "unknown", error: null },
          source: null,
        },
      };
    }

    const project = data.result;
    const lastDeploy = project.latest_deployment;
    const source = project.source;
    const domains = project.domains || [];
    const customDomain = domains.find((d: string) => d === game.domain);

    let deployError: string | null = null;
    if (lastDeploy?.latest_stage?.status === "failure") {
      deployError = `${lastDeploy.latest_stage.name || "Build"} failed`;
    }

    return {
      cf: {
        deploy: lastDeploy
          ? {
              status: lastDeploy.latest_stage?.status || "unknown",
              time: lastDeploy.created_on,
              url: lastDeploy.url,
              error: deployError,
              trigger: lastDeploy.deployment_trigger?.type || "unknown",
              commitMsg: lastDeploy.deployment_trigger?.metadata?.commit_message?.slice(0, 60) || null,
            }
          : { status: "none", time: null, url: null, error: "No deployments yet" },
        domain: customDomain
          ? { status: "active", cert: "active", error: null }
          : { status: "not_configured", cert: "none", error: "Custom domain not in project" },
        source: source
          ? { type: source.type, owner: source.config?.owner, repo: source.config?.repo_name, enabled: source.config?.deployments_enabled }
          : null,
      },
    };
  } catch (e) {
    return {
      cf: { deploy: { status: "error", time: null, url: null, error: String(e) }, domain: { status: "error", cert: "error", error: String(e) }, source: null },
    };
  }
}

async function fetchAllStatus(env: Env) {
  const games = await fetchRegistry(env);
  const results = await Promise.all(
    games.map(async (game) => {
      const status = await fetchGameStatus(game, env);
      return { ...game, ...status };
    })
  );
  return results;
}


// STRICT allowlist — the admin API must NOT reflect arbitrary game subdomains.
// Games are untrusted content; with credentialed CORS, a malicious game the
// admin opens could read /api/errors + /api/users (its cookie is sent) or CSRF
// provision/delete. The admin console is served same-origin from here, and the
// creator publish flow reaches this worker server-to-server (no browser Origin),
// so no *.freegamestore.online game origin ever needs cross-origin access.
const CORS_ORIGINS = new Set([
  "https://admin.freegamestore.online",
  "http://localhost:5173",
]);

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  const allowed = CORS_ORIGINS.has(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResponse(data: unknown, status: number, request: Request): Response {
  return new Response(JSON.stringify(data), {
    status,
    // no-store: these carry per-admin / observability data — the edge must never
    // cache them (a stale public copy is exactly how the creator list + crash
    // log leaked before the gate landed).
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders(request) },
  });
}

/** Latest CONCLUDED deploy.yml outcome for a game repo, or null when nothing has
 *  concluded yet (no runs, still queued/in-progress, or the API call failed).
 *
 *  Filters to deploy.yml specifically: a game repo carries several workflows
 *  (ci/compliance/deploy) and "latest run of any workflow" reads the wrong
 *  conclusion. `cancelled` is skipped rather than treated as failure — Path B
 *  provisioning lands several commits in quick succession and deploy.yml's
 *  `concurrency: cancel-in-progress` cancels the earlier runs by design, so a
 *  cancelled run says nothing about the build. Mirrors the agent's
 *  waitForActionsDeploy. */
async function latestDeployConclusion(env: Env, id: string): Promise<"success" | "failure" | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${ORG}/${id}/actions/workflows/deploy.yml/runs?per_page=5`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "freegamestore-admin",
          ...(env.GITHUB_TOKEN ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}),
        },
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      workflow_runs?: Array<{ status: string; conclusion: string | null }>;
    };
    for (const run of data.workflow_runs ?? []) {
      if (run.status !== "completed" || run.conclusion === "cancelled") continue;
      if (run.conclusion === "success") return "success";
      if (run.conclusion === "failure" || run.conclusion === "timed_out") return "failure";
    }
    return null;
  } catch {
    return null;
  }
}

/** One cached fleet sweep shared by /api/drift and /api/status/deploys.
 *
 *  ~2 GitHub calls per game (~250 for the current fleet), so it is cached 5
 *  minutes in the Worker cache. The cached copy lives under an INTERNAL key and
 *  is never the client response — those stay no-store, so per-admin data is
 *  never edge-cached. Returns null when the registry read failed, which callers
 *  must surface rather than treating as an empty fleet. */
async function cachedFleetSweep(env: Env): Promise<FleetRow[] | null> {
  const cacheKey = new Request("https://admin.freegamestore.online/__cache/fleet");
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const hit = cache ? await cache.match(cacheKey).catch(() => null) : null;
  if (hit) return (await hit.json()) as FleetRow[];

  const items = await fetchRegistryItems(env);
  if (items === null) return null;
  const ids = items.map((g) => g?.id).filter((id): id is string => typeof id === "string" && !!id);
  const rows = await sweepFleet(env, ORG, ids);
  if (cache) {
    await cache.put(
      cacheKey,
      new Response(JSON.stringify(rows), {
        headers: { "Content-Type": "application/json", "Cache-Control": "max-age=300" },
      }),
    ).catch(() => { /* caching is best-effort */ });
  }
  return rows;
}

interface ReconcileReport {
  ts: string;
  registryCount: number;
  routeCount: number;
  /** In the storefront registry but no D1 route → host returns 404 / CF 1014. */
  missingRoute: string[];
  /** Has a D1 route but isn't in the registry → drift (provision half-done or unlisted). */
  orphanRoute: string[];
  drift: boolean;
  /** True when the registry read FAILED (not merely empty). In this state the
   *  comparison is untrustworthy, so no drift is claimed and no healing runs. */
  registryError?: boolean;
  /** Registry entries still `pending` — provisioned, first build not yet confirmed. */
  pending?: string[];
  /** Populated only on the scheduled (heal=true) path: what was actually fixed. */
  healed?: { insertedRoutes: string[]; deletedRoutes: string[]; statusFlips?: string[] };
}

/** Compare the storefront registry against the D1 `routes` table and surface —
 *  and, on the scheduled path, HEAL — provisioning drift. A registry entry with
 *  no route is the CF-1014 symptom (game listed but unservable); a route with no
 *  registry entry is a half-done provision.
 *
 *  `heal=false` (the GET /api/reconcile report): read-only, mutates nothing.
 *  `heal=true` (the hourly cron): auto-fixes the two SAFE cases —
 *    - missingRoute → re-insert the idempotent host route (registry is truth).
 *    - orphanRoute  → delete the route (registry is truth; the game is delisted).
 *  It never archives/deletes a repo. If the registry read failed it heals
 *  NOTHING — a bad read must never delete a live route. */
async function reconcile(env: Env, heal = false): Promise<ReconcileReport> {
  const items = await fetchRegistryItems(env);
  const ts = new Date().toISOString();

  const routeRows = env.DB
    ? await env.DB
        .prepare(`SELECT slug FROM routes WHERE zone = ? AND hosted_on = 'r2'`)
        .bind(DOMAIN)
        .all<{ slug: string }>()
    : { results: [] as { slug: string }[] };
  const routeSlugs = new Set((routeRows.results ?? []).map((r) => r.slug));

  // Registry read failed → do NOT treat every route as orphan drift (that would
  // delete the whole fleet's routes once healing runs). Report the error, act on
  // nothing.
  if (items === null) {
    const report: ReconcileReport = {
      ts,
      registryCount: 0,
      routeCount: routeSlugs.size,
      missingRoute: [],
      orphanRoute: [],
      drift: false,
      registryError: true,
    };
    console.error(`[reconcile] registry read FAILED — skipping (no drift claimed, no heal)`);
    await recordError(env.DB, {
      source: "admin/reconcile",
      context: `heal=${heal}`,
      message: "registry read failed — reconcile skipped to avoid false drift",
    });
    return report;
  }

  const registryIds = new Set(items.map((g) => g.id).filter(Boolean));
  const missingRoute = [...registryIds].filter((id) => !routeSlugs.has(id)).sort();
  const orphanRoute = [...routeSlugs].filter((slug) => !registryIds.has(slug)).sort();
  const pending = items
    .filter((g) => g?.id && readGameStatus(g) === "pending")
    .map((g) => g.id as string)
    .sort();

  const report: ReconcileReport = {
    ts,
    registryCount: registryIds.size,
    routeCount: routeSlugs.size,
    missingRoute,
    orphanRoute,
    pending,
    // A pending game is NOT drift — provisioning before the build is deliberate.
    // It only becomes interesting if it never resolves, which the flip below
    // handles rather than alarming about.
    drift: missingRoute.length > 0 || orphanRoute.length > 0,
  };

  if (heal && env.DB && report.drift) {
    const insertedRoutes: string[] = [];
    const deletedRoutes: string[] = [];
    // Re-insert routes for listed-but-unrouted games (idempotent, same shape as
    // provision). registry is the source of truth for what SHOULD be served.
    for (const id of missingRoute) {
      const step = await insertHostRoute(env as any, id);
      if (step.status === "ok") insertedRoutes.push(id);
    }
    // Delete routes with no registry entry — the game is delisted, so the route
    // should stop resolving. Repos are left untouched (archive is not automatic).
    for (const slug of orphanRoute) {
      try {
        await env.DB.prepare("DELETE FROM routes WHERE slug = ? AND zone = ?").bind(slug, DOMAIN).run();
        deletedRoutes.push(slug);
      } catch {
        /* best-effort; next run retries */
      }
    }
    report.healed = { insertedRoutes, deletedRoutes };
  }

  // Backstop for the build-status field (#22). The agent reports the CI outcome
  // the moment it sees it, but it is NOT the only publisher — `fgs publish` (CLI)
  // and the MCP `create_game` tool provision without it, and any agent run that
  // dies mid-deploy never reports at all. Without this sweep those games would
  // sit `pending` forever and be hidden from the store — a worse bug than the one
  // #22 fixes. One batched registry commit per run, and it only ever moves
  // pending → live/failed.
  if (heal && pending.length > 0) {
    const flips: Array<{ id: string; status: "live" | "failed" }> = [];
    for (const id of pending) {
      const conclusion = await latestDeployConclusion(env, id);
      if (conclusion === "success") flips.push({ id, status: "live" });
      else if (conclusion === "failure") flips.push({ id, status: "failed" });
      // null → nothing concluded yet; leave pending for the next run.
    }
    if (flips.length > 0) {
      const res = await setGameStatuses(env as any, flips);
      report.healed = {
        ...(report.healed ?? { insertedRoutes: [], deletedRoutes: [] }),
        statusFlips: res.updated,
      };
      if (!res.ok) {
        console.error(`[reconcile] status flip FAILED: ${res.detail}`);
        await recordError(env.DB, {
          source: "admin/reconcile",
          context: `heal=${heal}`,
          message: `build-status flip failed: ${res.detail}`,
        });
      } else {
        console.log(`[reconcile] status flips: ${res.updated.join(", ") || "none"}`);
      }
    }
  }

  if (report.drift) {
    console.error(`[reconcile] DRIFT detected: ${JSON.stringify(report)}`);
    await recordError(env.DB, {
      source: "admin/reconcile",
      context: `heal=${heal}`,
      message: `drift: ${missingRoute.length} missingRoute, ${orphanRoute.length} orphanRoute`,
      stack: JSON.stringify(report).slice(0, 1500),
    });
  } else {
    console.log(`[reconcile] clean: ${report.registryCount} games, ${report.routeCount} routes`);
  }
  return report;
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // Hourly: heal provisioning drift, then prune the error log's old rows.
    ctx.waitUntil(reconcile(env, true));
    ctx.waitUntil(pruneErrors(env.DB));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight — unauthenticated (a preflight carries no cookies).
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    // CLI login mechanism — must stay reachable before the admin gate.
    // Self-contained auth: exchange a GitHub token for an FGS admin session,
    // then verify it. `fgs login` calls /v1/auth/exchange.
    if (url.pathname === "/v1/auth/exchange" && request.method === "POST") {
      return handleAuthExchange(request, env);
    }
    if (url.pathname === "/v1/auth/me" && request.method === "GET") {
      return handleAuthMe(request, env);
    }

    // --- ADMIN GATE ---------------------------------------------------------
    // The console UI + every observability/read endpoint are restricted to the
    // admin allowlist (verified Google email via the auth worker). The
    // creator-facing publish routes below — /api/provision, /api/publish, and
    // PATCH/DELETE /api/games/:id — keep their own per-caller auth and are
    // intentionally NOT admin-gated (creators self-serve; the agent uses the
    // internal token). Without this, the whole console + crash log + creator
    // list were world-readable.
    const ADMIN_PATHS = new Set([
      "/", "/docs", "/api/reconcile", "/api/drift", "/api/status/deploys", "/api/ping", "/api/status", "/api/status/game",
      "/api/quality", "/api/errors", "/api/stats", "/api/users",
    ]);
    // The Game Detail endpoint is a regex path, so it cannot live in the exact
    // -match Set above — gate it explicitly rather than leaving it open.
    const ADMIN_PATH_RE = /^\/api\/games\/[a-z0-9][a-z0-9-]*\/detail$/;
    if (ADMIN_PATHS.has(url.pathname) || ADMIN_PATH_RE.test(url.pathname)) {
      const { email, isAdmin } = await authenticateAdmin(request, env);
      if (!isAdmin) {
        // Console pages get the sign-in / wrong-account page (200 — it IS a
        // valid page, and a 401 status just spams the browser console); APIs
        // still return 401.
        if (url.pathname === "/" || url.pathname === "/docs") {
          return new Response(renderSignIn(email), {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
          });
        }
        return jsonResponse({ error: "unauthorized" }, 401, request);
      }
    }

    // GET /api/drift — stale-deploy canary (#10 Part B): games whose main HEAD is
    // newer than their last SUCCESSFUL deploy.yml run, i.e. commits that never
    // reached R2. Distinct from /api/reconcile (registry ↔ route drift) and from
    // #22's `status` (has this game ever built at all).
    //
    // Cached 5 minutes in the Worker cache because this is ~2 GitHub calls per
    // registered game — around 250 for the current fleet. Uncached, a couple of
    // dashboard refreshes would burn the hourly API budget. The cached copy is an
    // internal key, never the client response, which stays no-store.
    if ((url.pathname === "/api/drift" || url.pathname === "/api/status/deploys") && request.method === "GET") {
      const rows = await cachedFleetSweep(env);
      if (rows === null) {
        // Same rule as reconcile: a failed registry read must not read as "no
        // games" and therefore "no drift" — that is a false all-clear.
        return jsonResponse({ error: "registry read failed — fleet not swept" }, 503, request);
      }
      if (url.pathname === "/api/status/deploys") {
        return jsonResponse(
          { ts: new Date().toISOString(), games: rows.map((r) => ({ id: r.id, conclusion: r.conclusion, drifted: r.state === "drifted" })) },
          200,
          request,
        );
      }
      const report = driftReportFrom(rows);
      if (report.drifted.length) {
        console.warn(`[drift] ${report.drifted.length} game(s) serving stale builds: ${report.drifted.map((d) => d.id).join(", ")}`);
      }
      return jsonResponse(report, 200, request);
    }

    // GET /api/ping — liveness probe for the admin worker itself (#14 item 8).
    // Admin-gated like every other observability endpoint: an unauthenticated
    // probe would confirm the worker exists to anyone who asks.
    if (url.pathname === "/api/ping" && request.method === "GET") {
      return jsonResponse({ ok: true, worker: "freegamestore-admin" }, 200, request);
    }

    // GET /api/games/:id/detail — everything the Game Detail page needs in one
    // round trip: live reachability, D1 route, registry listing + build status,
    // and the last 5 deploy runs.
    const detailMatch = url.pathname.match(/^\/api\/games\/([a-z0-9][a-z0-9-]*)\/detail$/);
    if (detailMatch && request.method === "GET") {
      const id = detailMatch[1]!;
      const items = (await fetchRegistryItems(env)) ?? [];
      const entry = items.find((g) => g?.id === id) ?? null;

      const routeRow = env.DB
        ? await env.DB.prepare("SELECT slug, r2_prefix, hosted_on FROM routes WHERE slug = ? AND zone = ?")
            .bind(id, DOMAIN)
            .first<{ slug: string; r2_prefix: string; hosted_on: string }>()
            .catch(() => null)
        : null;

      // HEAD probe with a timeout — a hung origin must not hold the request open.
      let http: { ok: boolean; status: number | null; error?: string } = { ok: false, status: null };
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        try {
          const res = await fetch(`https://${id}.${DOMAIN}`, { method: "HEAD", signal: ctrl.signal });
          http = { ok: res.ok, status: res.status };
        } finally {
          clearTimeout(timer);
        }
      } catch (e) {
        http = { ok: false, status: null, error: String(e) };
      }

      return jsonResponse({
        id,
        listed: !!entry,
        status: readGameStatus(entry),
        name: entry?.name ?? id,
        creatorGithub: entry?.creatorGithub ?? null,
        hostedOn: entry?.hostedOn ?? (routeRow?.hosted_on || "unknown"),
        route: routeRow ? { configured: true, r2Prefix: routeRow.r2_prefix } : { configured: false },
        url: `https://${id}.${DOMAIN}`,
        repo: `${ORG}/${id}`,
        http,
        runs: await recentRuns(env, ORG, id, 5),
      }, 200, request);
    }

    // GET /api/reconcile — on-demand drift report (same logic as the cron).
    if (url.pathname === "/api/reconcile" && request.method === "GET") {
      return jsonResponse(await reconcile(env), 200, request);
    }

    if (url.pathname === "/docs") {
      return new Response(renderApiDocs(), { headers: { "Content-Type": "text/html", "Cache-Control": "no-store" } });
    }

    if (url.pathname === "/api/status") {
      const detail = url.searchParams.get("detail") === "true";
      if (detail) {
        const data = await fetchAllStatus(env);
        return jsonResponse(data, 200, request);
      }
      const games = await fetchRegistry(env);
      return jsonResponse(games, 200, request);
    }

    if (url.pathname === "/api/status/game") {
      const id = url.searchParams.get("id");
      if (!id) {
        return jsonResponse({ error: "id required" }, 400, request);
      }
      const games = await fetchRegistry(env);
      const game = games.find(g => g.id === id);
      if (!game) {
        return jsonResponse({ error: "not found" }, 404, request);
      }
      const status = await fetchGameStatus(game, env);
      return jsonResponse({ ...game, ...status }, 200, request);
    }

    if (url.pathname === "/api/quality") {
      const data = await fetchQuality();
      if (!data) {
        return new Response(null, { status: 204, headers: corsHeaders(request) });
      }
      return jsonResponse(data, 200, request);
    }

    // Errors/crashes for the console (protected by CF Access, like /api/status).
    if (url.pathname === "/api/errors") {
      // Clamp: a negative limit is "unlimited" in SQLite (bypasses the 500 cap),
      // and NaN must fall back to the default.
      const raw = parseInt(url.searchParams.get("limit") || "200", 10);
      const limit = Math.max(1, Math.min(Number.isFinite(raw) ? raw : 200, 500));
      const user = url.searchParams.get("user") || undefined;
      const source = url.searchParams.get("source") || undefined;
      return jsonResponse(await listErrors(env.DB, limit, { user, source }), 200, request);
    }

    // Aggregate stats + the errors-per-day series for the Overview graph.
    if (url.pathname === "/api/stats") {
      const [games, errStats] = await Promise.all([fetchRegistry(env), errorStats(env.DB)]);
      const creators = new Set<string>();
      for (const g of await fetchRegistryRaw(env)) if (g.creatorGithub) creators.add(String(g.creatorGithub).toLowerCase());
      return jsonResponse(
        { games: games.length, creators: creators.size, errorsTotal: errStats.total, errors24h: errStats.last24h, errorSeries: errStats.series },
        200,
        request,
      );
    }

    // Creators derived from the registry (creatorGithub), with their game counts.
    if (url.pathname === "/api/users") {
      const raw = await fetchRegistryRaw(env);
      const byUser = new Map<string, { login: string; games: string[] }>();
      for (const g of raw) {
        const login = g.creatorGithub ? String(g.creatorGithub) : "(unknown)";
        const key = login.toLowerCase();
        if (!byUser.has(key)) byUser.set(key, { login, games: [] });
        byUser.get(key)!.games.push(String(g.id));
      }
      const users = [...byUser.values()].sort((a, b) => b.games.length - a.games.length);
      return jsonResponse(users, 200, request);
    }

    // Complimentary access grants (admin-only). The agent worker owns the vault
    // DB + platform keys; this proxies to its INTERNAL_TOKEN-gated endpoint.
    // Authenticated here by the same Google-email allowlist as the console — the
    // path-param DELETE isn't in ADMIN_PATHS, so this block authenticates itself.
    //   GET    /api/comp            → list grants + which providers are funded
    //   POST   /api/comp            → { login, provider, model, note?, expiresAt? }
    //   DELETE /api/comp/:userId    → revoke (userId = github:<id>)
    if (url.pathname === "/api/comp" || url.pathname.startsWith("/api/comp/") || url.pathname === "/api/allusers" || url.pathname.startsWith("/api/userkey") || url.pathname === "/api/sessions" || url.pathname === "/api/sessionhistory" || url.pathname === "/api/sessionerrors" || url.pathname === "/api/sessionchat") {
      const { email, isAdmin } = await authenticateAdmin(request, env);
      if (!isAdmin) return jsonResponse({ error: "unauthorized" }, 401, request);
      if (!env.AGENT || !env.INTERNAL_TOKEN) {
        return jsonResponse({ error: "admin↔agent not wired (missing AGENT binding or INTERNAL_TOKEN)" }, 500, request);
      }
      // Map admin paths → agent paths: /api/allusers → users listing,
      // /api/userkey* → vault key write, /api/comp* → complimentary grants,
      // /api/sessions + /api/sessionhistory → all-users VibeCode session views.
      const agentPath = url.pathname === "/api/allusers"
        ? "/v1/admin/users"
        : url.pathname === "/api/sessions"
        // url.search carries ?cursor=&limit= through to the agent (#25). Its
        // absence here was why pagination could not be implemented admin-side:
        // params were dropped before the hop, unlike the session-* paths below.
        ? "/v1/admin/sessions" + url.search
        : url.pathname === "/api/sessionhistory"
        ? "/v1/admin/session-history" + url.search
        : url.pathname === "/api/sessionerrors"
        ? "/v1/admin/session-errors" + url.search
        : url.pathname === "/api/sessionchat"
        ? "/v1/admin/session-chat" + url.search
        : url.pathname.startsWith("/api/userkey")
        ? url.pathname.replace(/^\/api\/userkey/, "/v1/admin/userkey")
        : url.pathname.replace(/^\/api\/comp/, "/v1/admin/comp");
      const res = await env.AGENT.fetch("https://agent.freegamestore.online" + agentPath, {
        method: request.method,
        headers: {
          "X-Internal-Token": env.INTERNAL_TOKEN,
          "X-Admin-Actor": email || "admin",
          ...(request.method === "POST" ? { "Content-Type": "application/json" } : {}),
        },
        body: request.method === "POST" ? await request.text() : undefined,
      });
      // session-chat streams SSE back from the DO turn — pass it through
      // untouched so the browser can hold it open while the agent works.
      if (url.pathname === "/api/sessionchat") {
        return new Response(res.body, {
          status: res.status,
          headers: { "Content-Type": res.headers.get("Content-Type") || "text/event-stream", "Cache-Control": "no-store", ...corsHeaders(request) },
        });
      }
      const text = await res.text();
      return new Response(text, {
        status: res.status,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders(request) },
      });
    }

    // PATCH /api/games/:id — update game metadata (name, description, category)
    const gameMatch = url.pathname.match(/^\/api\/games\/([a-z0-9][a-z0-9-]*)$/);
    if (gameMatch && request.method === "PATCH") {
      const login = await authenticateLogin(request, env);
      if (!login) {
        return jsonResponse({ error: "unauthorized" }, 401, request);
      }
      try {
        const body = await request.json() as Record<string, unknown>;
        const result = await handleUpdateGame(gameMatch[1]!, login, body, env as any);
        return jsonResponse(result, result.error ? 400 : 200, request);
      } catch (e) {
        await recordError(env.DB, { source: "admin/games.patch", user: login, context: `id=${gameMatch[1]}`, message: (e as Error)?.message ?? String(e), stack: (e as Error)?.stack });
        return jsonResponse({ error: String(e) }, 500, request);
      }
    }

    // DELETE /api/games/:id — delete a game the caller owns (delist + drop route
    // + archive repo).
    if (gameMatch && request.method === "DELETE") {
      const login = await authenticateLogin(request, env);
      // Deprovision from the console (#14): an admin must be able to delete a
      // game they did NOT create, otherwise the button only ever works on their
      // own games. Gated on the ADMIN_EMAILS allowlist — the same gate as every
      // observability endpoint — and logged inside handleDeleteGame, because
      // this delists the game, drops its route and archives the repo.
      const { email, isAdmin } = await authenticateAdmin(request, env);
      const actor = login || (isAdmin ? email : null);
      if (!actor) {
        return jsonResponse({ error: "unauthorized" }, 401, request);
      }
      try {
        const result = await handleDeleteGame(gameMatch[1]!, actor, env as any, { adminOverride: isAdmin });
        return jsonResponse(result, result.error ? 400 : 200, request);
      } catch (e) {
        await recordError(env.DB, { source: "admin/games.delete", user: login, context: `id=${gameMatch[1]}`, message: (e as Error)?.message ?? String(e), stack: (e as Error)?.stack });
        return jsonResponse({ error: String(e) }, 500, request);
      }
    }

    // POST /api/internal/error — record a platform error into the shared
    // error_log this console reads (#21).
    //
    // This exists because the agent CANNOT insert the row itself. The issue
    // assumed both workers bind the same D1; they do not — the agent's `DB` is
    // the `leaderboard` database (165c4cb7…) while error_log lives in admin's
    // `freegamestore` database (a122751e…). A direct INSERT from the agent would
    // silently create an error_log table in the WRONG database, where nothing
    // reads it — the same invisibility this issue is fixing, only harder to spot.
    //
    // Internal token only: error_log backs the Errors view and the Overview
    // counts, so an unauthenticated caller could flood or poison operator triage.
    if (url.pathname === "/api/internal/error" && request.method === "POST") {
      const internal = request.headers.get("X-Internal-Token");
      if (!(internal && env.INTERNAL_TOKEN && safeEqual(internal, env.INTERNAL_TOKEN))) {
        return jsonResponse({ error: "unauthorized" }, 401, request);
      }
      const body = (await request.json().catch(() => ({}))) as {
        source?: unknown; user?: unknown; context?: unknown; message?: unknown; stack?: unknown;
      };
      const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
      const source = str(body.source);
      const message = str(body.message);
      if (!source || !message) {
        return jsonResponse({ error: "source and message are required" }, 400, request);
      }
      await recordError(env.DB, {
        source,
        user: str(body.user),
        context: str(body.context),
        message,
        stack: str(body.stack),
      });
      return jsonResponse({ ok: true }, 200, request);
    }

    // POST /api/game-status — report a CONCLUDED build outcome for a game (#22).
    // Fast path for the field the hourly reconcile also maintains: the agent sees
    // the deploy.yml conclusion within seconds and calls this, so a creator's game
    // goes live in the store immediately instead of waiting up to an hour.
    //
    // Internal token ONLY. The registry `status` decides whether a game is shown
    // as live store-wide, so this is not something a user-authenticated caller
    // should be able to set for themselves. Every non-agent publisher (CLI, MCP)
    // is covered by reconcile's sweep instead — no extra auth surface needed.
    if (url.pathname === "/api/game-status" && request.method === "POST") {
      const internal = request.headers.get("X-Internal-Token");
      if (!(internal && env.INTERNAL_TOKEN && safeEqual(internal, env.INTERNAL_TOKEN))) {
        return jsonResponse({ error: "unauthorized" }, 401, request);
      }
      const body = (await request.json().catch(() => ({}))) as { id?: string; status?: string };
      if (!body.id || (body.status !== "live" && body.status !== "failed")) {
        return jsonResponse({ error: "id and status ('live'|'failed') are required" }, 400, request);
      }
      const step = await setGameStatus(env as any, body.id, body.status);
      if (step.status === "fail") {
        await recordError(env.DB, {
          source: "admin/game-status",
          context: `id=${body.id} status=${body.status}`,
          message: step.detail,
        });
      }
      return jsonResponse({ ok: step.status !== "fail", step }, step.status === "fail" ? 500 : 200, request);
    }

    if ((url.pathname === "/api/provision" || url.pathname === "/api/publish") && request.method === "POST") {
      // Auth required (admin session, or fgs_token from MCP/console). Without this,
      // anyone reachable to admin.freegamestore.online can provision repos in
      // freegamestore-online and mint CF resources. CF Access adds defense-in-depth.
      //
      // Trusted worker-to-worker path: the agent (VibeCode deploy) holds no user
      // fgs_token at deploy time, so it presents the shared INTERNAL_TOKEN via
      // X-Internal-Token. In that case the owner comes from the request body's
      // creatorGithub (validated downstream against GitHub's username grammar).
      const internal = request.headers.get("X-Internal-Token");
      const trusted = !!(internal && env.INTERNAL_TOKEN && safeEqual(internal, env.INTERNAL_TOKEN));
      const login = trusted ? null : await authenticateLogin(request, env);
      if (!trusted && !login) {
        return jsonResponse({ error: "unauthorized" }, 401, request);
      }
      const t0 = Date.now();
      let ownerForLog: string | undefined;
      let idForLog: string | undefined;
      try {
        const body = await request.json() as any;
        idForLog = body?.id;
        // Ownership is caller-derived for user-authenticated calls: a normal
        // authenticated caller must NOT be able to register a game owned by an
        // arbitrary `creatorGithub` they put in the body (that would be ownership
        // spoofing once registry `creatorGithub` becomes the ownership signal).
        // Only the trusted worker-to-worker path (agent deploy, internal token)
        // may specify the owner in the body — it passes the real creator's login.
        const owner = trusted ? body.creatorGithub : login;
        ownerForLog = owner;
        if (trusted && !owner) {
          return jsonResponse({ error: "creatorGithub required for internal provision" }, 400, request);
        }
        console.log(`[provision] id=${body?.id} owner=${owner} trusted=${trusted}`);
        const result = await handlePublish({ ...body, creatorGithub: owner }, env as any);
        console.log(`[provision] id=${body?.id} success=${result.success} +${Date.now() - t0}ms`);
        // Persist a provision failure (handlePublish returns success:false rather
        // than throwing) so it shows on the admin console. Logging only — the
        // response is unchanged.
        if (!result.success) {
          // handlePublish reports failures per-step (no top-level `error`), so
          // build the message from the failed step(s).
          const failMsg = (result.steps || [])
            .filter((s) => s.status === "fail")
            .map((s) => `${s.name}: ${s.detail}`)
            .join("; ") || "provision returned success:false";
          await recordError(env.DB, { source: "admin/provision", user: owner, context: `id=${body?.id} +${Date.now() - t0}ms`, message: failMsg, stack: JSON.stringify(result).slice(0, 1500) });
        }
        return jsonResponse(result, result.success ? 200 : 400, request);
      } catch (e) {
        await recordError(env.DB, { source: "admin/provision", user: ownerForLog, context: `id=${idForLog} threwAfter=${Date.now() - t0}ms`, message: (e as Error)?.message ?? String(e), stack: (e as Error)?.stack });
        return jsonResponse({ error: String(e) }, 500, request);
      }
    }

    // Fallthrough (any unmatched path/method) also renders the console shell, so
    // it must be gated like "/" — otherwise GET /anything served the full,
    // indexable dashboard HTML to anyone (info disclosure; the /api/* it calls
    // still 401, but the shell shouldn't be world-readable). Non-admins get the
    // sign-in page.
    const { email, isAdmin } = await authenticateAdmin(request, env);
    if (!isAdmin) {
      return new Response(renderSignIn(email), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
    // Serve the built React app (Workers Static Assets; hash routing, so any
    // authed non-API path resolves to the asset or falls back to index.html).
    if (env.ASSETS) {
      const assetRes = await env.ASSETS.fetch(request);
      if (assetRes.status !== 404) return assetRes;
      return env.ASSETS.fetch(new Request(new URL("/", request.url).toString(), { headers: request.headers }));
    }
    return new Response("admin app assets missing (build web/)", { status: 500 });
  },
};
