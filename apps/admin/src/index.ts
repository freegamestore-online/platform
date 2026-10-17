import { normalizeErrorLogRow } from '../../../contracts/error-log/v1/contract';
import { routeAdminRequest } from './admin-request-router';
import { serveAdminStatic } from './admin-static';
import { handleAuthExchange, handleAuthMe, verifySession } from './auth';
import { getGameAnalytics, putGameAnalyticsConfig } from './game-analytics';
import { handlePlatformUsage } from './platform-usage';
import { renderApiDocs } from './dashboard';
import { driftReportFrom, type FleetRow, recentRuns, sweepFleet } from './drift';
import { errorStats, listErrors, pruneErrors, recordError } from './errlog';
import { createGameLifecycle } from './lifecycle/game-lifecycle';
import { createRegistryState, createRemixSource } from './lifecycle/registry-state';
import {
  type GameStatus,
  insertHostRoute,
  type LifecycleErrorCode,
  lifecycleStatus,
  provisionStatus,
  readGameStatus,
} from './publish';
import { type RegistryGame, readRegistry } from './registryReader';

type CallerCredentials = {
  admin: string | null;
  isAdmin: boolean;
  login: string | null;
};

/** Result of a game lifecycle operation (update or delete). When error is
 *  present, code indicates the error type for HTTP status mapping. */
type GameLifecycleResult = { ok?: boolean; error?: string; code?: LifecycleErrorCode };

interface RouteParams {
  request: Request;
  env: Env;
  url: URL;
  caller: CallerCredentials;
  match: RegExpMatchArray | null;
  data: ReturnType<typeof dataService>;
}

interface Route {
  method: string | string[];
  pattern: string | RegExp;
  auth: 'admin' | 'login' | 'internal' | 'ci' | 'public';
  handler: (params: RouteParams) => Promise<Response>;
}

interface Env {
  CF_ACCOUNT_ID: string;
  CF_API_TOKEN: string;
  /** Token with Analytics Engine read scope for the per-game stats (#354). Optional:
   *  the stats endpoints answer 503 until it is set via `wrangler secret put`. */
  CF_ANALYTICS_API_TOKEN?: string;
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
  /** KV for the CI test report (#24). OPTIONAL — the namespace does not exist
   *  yet, so the endpoints answer 503 until it is created and bound. Declared
   *  optional deliberately: a `[[kv_namespaces]]` entry pointing at a
   *  non-existent id makes `wrangler deploy` FAIL, which would break every
   *  admin deploy rather than just this feature. */
  CI_KV?: KVNamespace;
  /** Shared secret CI presents as X-CI-Token when uploading a report (#24). */
  CI_TOKEN?: string;
  /** Cloudflare zone id for freegamestore.online (#23 item 6). Only `zone_name`
   *  exists in config today and the Analytics GraphQL API keys on `zoneTag`, so
   *  this must be supplied before the traffic widget can resolve. */
  CF_ZONE_ID?: string;
  /** Comma-separated allowlist of admin emails. The console UI + every
   *  observability endpoint are restricted to these (verified Google emails
   *  resolved via the auth worker's /me). Falls back to the sole owner. */
  ADMIN_EMAILS?: string;
}

// The HTTP layer only depends on these narrow lifecycle ports. The GitHub/D1
// implementation remains in publish.ts and can be replaced by contract fakes.
const gameLifecycle = createGameLifecycle();
const registryState = createRegistryState();
const remixSource = createRemixSource();

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
  return (env.ADMIN_EMAILS || 'serge.the.dev@gmail.com')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// Session audiences /me may accept for each kind of caller (#69).
const ADMIN_AUDIENCES = 'https://admin.freegamestore.online,https://mcp.freegamestore.online';
const LOGIN_AUDIENCES =
  'https://admin.freegamestore.online,https://console.freegamestore.online,https://mcp.freegamestore.online';

/** Resolve the signed-in user's verified email via the auth worker, and whether
 *  they're an admin. Returns `email: null` when not signed in at all (so the
 *  sign-in page can tell "sign in" from "wrong account"). */
async function authenticateAdmin(
  request: Request,
  env: Env,
): Promise<{ email: string | null; isAdmin: boolean }> {
  const authz = request.headers.get('Authorization') ?? '';
  const bearer = authz.startsWith('Bearer ') ? authz.slice(7).trim() : '';
  const cookie = request.headers.get('Cookie') ?? '';
  const fgsToken =
    request.headers.get('X-FGS-Token') || cookie.match(/__Host-fgs_token=([^;]*)/)?.[1] || bearer;
  if (!fgsToken) return { email: null, isAdmin: false };
  try {
    // X-FGS-Token so /me returns the email (it withholds it on other paths).
    // X-FGS-Audience: admin rights come only from an admin- or MCP-issued
    // session, never another site's session or a handoff (#69).
    const meRes = await env.AUTH.fetch('https://auth.freegamestore.online/me', {
      headers: { 'X-FGS-Token': fgsToken, 'X-FGS-Audience': ADMIN_AUDIENCES },
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
  const loginUrl =
    'https://auth.freegamestore.online/login/google?redirect=' +
    encodeURIComponent('https://admin.freegamestore.online/');
  const wrong = signedInAs
    ? `<p class="note">Signed in as <strong>${escapeHtml(signedInAs)}</strong> — that account isn't an admin.</p>`
    : `<p class="note">This console is restricted to the store administrator.</p>`;
  const cta = signedInAs ? 'Use a different account' : 'Sign in with Google';
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
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/** Extract the authenticated GitHub login from either credential the platform issues:
 *  1. Bearer admin session token (CLI `fgs login`)
 *  2. fgs_token — as an Authorization Bearer (MCP) OR an fgs_token cookie (console),
 *     verified by the auth worker's /me (single uniform identity, like the other stores). */
async function authenticateLogin(request: Request, env: Env): Promise<string | null> {
  const auth = request.headers.get('Authorization') ?? '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';

  // 1. Admin-minted session token (CLI).
  if (bearer) {
    const login = await verifySession(bearer, env.SESSION_SIGNING_KEY);
    if (login) return login;
  }

  // 2. fgs_token — via X-FGS-Token (MCP, worker-to-worker), cookie (console),
  //    or the Bearer fallback. The auth worker's /me verifies the signature.
  const cookie = request.headers.get('Cookie') ?? '';
  const fgsToken =
    request.headers.get('X-FGS-Token') || cookie.match(/__Host-fgs_token=([^;]*)/)?.[1] || bearer;
  if (fgsToken) {
    try {
      // Service binding (not a public-hostname fetch — that loops back, CF 522).
      // The console forwards its session for creator actions (provision, game
      // edits), and MCP calls with its own; any other site's session is refused.
      const meRes = await env.AUTH.fetch('https://auth.freegamestore.online/me', {
        headers: { 'X-FGS-Token': fgsToken, 'X-FGS-Audience': LOGIN_AUDIENCES },
      });
      if (meRes.ok) {
        await meRes.json();
        const parts = fgsToken.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as {
            login?: string;
            sub?: string;
          };
          return typeof payload.login === 'string' ? payload.login : null;
        }
        return null;
      }
    } catch {
      /* fall through */
    }
  }
  return null;
}

/** Unified caller resolution for all routes. Returns admin email (if authenticated
 *  via Google), admin status, and GitHub login (if authenticated via fgs_token/session).
 *  Routes can then check isAdmin OR login based on their requirements. */
async function resolveCaller(request: Request, env: Env): Promise<CallerCredentials> {
  const [{ email, isAdmin }, login] = await Promise.all([
    authenticateAdmin(request, env),
    authenticateLogin(request, env),
  ]);
  return { admin: email, isAdmin, login };
}

/** Auth transport is deliberately kept ahead of every API/static route. */
async function handleAdminAuthRoute(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  // Auth owns the OAuth state cookie; this origin only receives a signed,
  // short-lived handoff and writes its own host-only session cookie.
  if (url.pathname === '/auth/handoff' && request.method === 'GET') {
    const handoff = url.searchParams.get('token') ?? '';
    if (!handoff) return new Response('missing session handoff', { status: 400 });
    const exchanged = await env.AUTH.fetch('https://auth.freegamestore.online/handoff/consume', {
      method: 'POST',
      headers: {
        'X-FGS-Handoff': handoff,
        'X-FGS-Handoff-Target': 'https://admin.freegamestore.online',
      },
    });
    if (!exchanged.ok) return new Response('invalid or expired session handoff', { status: 401 });
    const body = (await exchanged.json()) as { token?: string };
    if (!body.token) return new Response('invalid session handoff response', { status: 502 });
    const returnTo = url.searchParams.get('return_to');
    let location = 'https://admin.freegamestore.online/';
    try {
      if (returnTo && new URL(returnTo).origin === 'https://admin.freegamestore.online')
        location = returnTo;
    } catch {
      /* safe default */
    }
    const headers = new Headers({
      Location: location,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    });
    headers.append(
      'Set-Cookie',
      `__Host-fgs_token=${body.token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
    );
    headers.append(
      'Set-Cookie',
      'fgs_token=; Domain=.freegamestore.online; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
    );
    return new Response(null, { status: 302, headers });
  }
  if (url.pathname === '/v1/auth/exchange' && request.method === 'POST')
    return handleAuthExchange(request, env);
  if (url.pathname === '/v1/auth/me' && request.method === 'GET') return handleAuthMe(request, env);
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

const QUALITY_URL =
  'https://raw.githubusercontent.com/freegamestore-online/freegamestore/main/data/quality-results.json';
const ORG = 'freegamestore-online';
const DOMAIN = 'freegamestore.online';

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
async function fetchRegistryItems(env: Env): Promise<RegistryGame[] | null> {
  const result = await readRegistry(env.GITHUB_TOKEN);
  return result.status === 'available' ? result.games : null;
}

async function fetchRegistry(env: Env): Promise<GameConfig[]> {
  const items = (await fetchRegistryItems(env)) ?? [];
  return items.map(
    (item: RegistryGame): GameConfig => ({
      id: item.id,
      name: item.name || '',
      org: ORG,
      cfProject: (item.cfProject as string) || `free${item.id}app`,
      domain: `${item.id}.${DOMAIN}`,
      hostedOn: (item.hostedOn as string) || 'pages',
      status: registryState.readStatus(item),
    }),
  );
}

/** Raw registry items (keeps fields fetchRegistry() drops, e.g. creatorGithub)
 *  — backs the Users tab + creator stats. A fetch failure renders as empty here
 *  (best-effort read path); reconcile() uses fetchRegistryItems() directly so it
 *  can distinguish failure from empty. */
async function fetchRegistryRaw(env: Env): Promise<RegistryGame[]> {
  return (await fetchRegistryItems(env)) ?? [];
}

async function fetchQuality(): Promise<QualityData | null> {
  try {
    const res = await fetch(QUALITY_URL, { headers: { 'User-Agent': 'freegamestore-admin' } });
    if (!res.ok) return null;
    return (await res.json()) as QualityData;
  } catch {
    return null;
  }
}

async function fetchGameStatus(game: GameConfig, env: Env) {
  // Path B (R2) games have no CF Pages project — querying one always 404s and
  // reports a bogus "no_project" error. Every current FGS game is on Path B,
  // so without this short-circuit the whole dashboard reads as broken.
  if (game.hostedOn === 'r2') {
    return {
      cf: {
        deploy: { status: 'r2', time: null, url: `https://${game.domain}`, error: null },
        domain: { status: 'active', cert: 'active', error: null },
        source: null,
      },
    };
  }
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/pages/projects/${game.cfProject}`,
      { headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` } },
    );
    const data = (await res.json()) as Record<string, unknown>;

    if (!data.success) {
      return {
        cf: {
          deploy: {
            status: 'no_project',
            time: null,
            url: null,
            error: `Project "${game.cfProject}" not found`,
          },
          domain: { status: 'unknown', cert: 'unknown', error: null },
          source: null,
        },
      };
    }

    const project = data.result as Record<string, unknown>;
    const lastDeploy = project.latest_deployment as Record<string, unknown> | undefined;
    const source = project.source as Record<string, unknown> | undefined;
    const domains = (project.domains as string[]) || [];
    const customDomain = domains.find((d: string) => d === game.domain);

    let deployError: string | null = null;
    const latestStage = lastDeploy
      ? (lastDeploy.latest_stage as Record<string, unknown> | undefined)
      : undefined;
    if (latestStage?.status === 'failure') {
      deployError = `${(latestStage.name as string) || 'Build'} failed`;
    }

    const deploymentTrigger = lastDeploy
      ? (lastDeploy.deployment_trigger as Record<string, unknown> | undefined)
      : undefined;
    const sourceConfig = source
      ? (source.config as Record<string, unknown> | undefined)
      : undefined;

    return {
      cf: {
        deploy: lastDeploy
          ? {
              status: (latestStage?.status as string) || 'unknown',
              time: lastDeploy.created_on as string | null,
              url: lastDeploy.url as string | null,
              error: deployError,
              trigger: (deploymentTrigger?.type as string) || 'unknown',
              commitMsg:
                (
                  (deploymentTrigger?.metadata as Record<string, unknown>)?.commit_message as string
                )?.slice(0, 60) || null,
            }
          : { status: 'none', time: null, url: null, error: 'No deployments yet' },
        domain: customDomain
          ? { status: 'active', cert: 'active', error: null }
          : { status: 'not_configured', cert: 'none', error: 'Custom domain not in project' },
        source: source
          ? {
              type: sourceConfig?.type as string | undefined,
              owner: sourceConfig?.owner as string | undefined,
              repo: sourceConfig?.repo_name as string | undefined,
              enabled: sourceConfig?.deployments_enabled as boolean | undefined,
            }
          : null,
      },
    };
  } catch (e) {
    return {
      cf: {
        deploy: { status: 'error', time: null, url: null, error: String(e) },
        domain: { status: 'error', cert: 'error', error: String(e) },
        source: null,
      },
    };
  }
}

async function fetchAllStatus(env: Env) {
  const games = await fetchRegistry(env);
  const results = await Promise.all(
    games.map(async (game) => {
      const status = await fetchGameStatus(game, env);
      return { ...game, ...status };
    }),
  );
  return results;
}

function dataService(env: Env) {
  return {
    registryItems: () => fetchRegistryItems(env),
    registry: () => fetchRegistry(env),
    registryRaw: () => fetchRegistryRaw(env),
    gameStatus: (game: GameConfig) => fetchGameStatus(game, env),
    allStatus: () => fetchAllStatus(env),
    quality: fetchQuality,
  };
}

// STRICT allowlist — the admin API must NOT reflect arbitrary game subdomains.
// Games are untrusted content; with credentialed CORS, a malicious game the
// admin opens could read /api/errors + /api/users (its cookie is sent) or CSRF
// provision/delete. The admin console is served same-origin from here, and the
// creator publish flow reaches this worker server-to-server (no browser Origin),
// so no *.freegamestore.online game origin ever needs cross-origin access.
const CORS_ORIGINS = new Set(['https://admin.freegamestore.online', 'http://localhost:5173']);

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin') ?? '';
  const allowed = CORS_ORIGINS.has(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? origin : '',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(data: unknown, status: number, request: Request): Response {
  return new Response(JSON.stringify(data), {
    status,
    // no-store: these carry per-admin / observability data — the edge must never
    // cache them (a stale public copy is exactly how the creator list + crash
    // log leaked before the gate landed).
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...corsHeaders(request),
    },
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
/** Commit messages of provisioning's own commits (GitHub's template generate,
 *  then admin's naming / remix commits). Used to recognise scaffold runs for
 *  registry entries that predate `provisionedSha`. */
const PROVISIONING_COMMIT =
  /^(?:Initial commit$|Set game name to "|Remix source from |Add immutable Remix attribution)/;

type DeployRun = {
  status: string;
  conclusion: string | null;
  head_sha?: string;
  head_commit?: { message?: string } | null;
};

/** Whether a deploy run built only the unbuilt template scaffold (#67): a commit
 *  at or before `provisionedSha`, the repo HEAD when provisioning finished. A
 *  run on a later commit, or on unrelated history (the creator force-pushed
 *  their own project over the scaffold), is real creator code. When GitHub
 *  can't answer, the run is treated as scaffold, so the game stays pending
 *  rather than being declared live on a guess. */
export async function isScaffoldRun(
  env: Pick<Env, 'GITHUB_TOKEN'>,
  id: string,
  run: DeployRun,
  provisionedSha?: string,
): Promise<boolean> {
  if (!provisionedSha) return PROVISIONING_COMMIT.test(run.head_commit?.message ?? '');
  if (!run.head_sha) return true;
  if (run.head_sha === provisionedSha) return true;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${ORG}/${id}/compare/${provisionedSha}...${run.head_sha}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'freegamestore-admin',
          ...(env.GITHUB_TOKEN ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}),
        },
      },
    );
    if (res.status === 404) return false; // no common history: a force-pushed project
    if (!res.ok) return true;
    const { status } = (await res.json()) as { status?: string };
    return status === 'identical' || status === 'behind';
  } catch {
    return true;
  }
}

async function latestDeployConclusion(
  env: Env,
  id: string,
  provisionedSha?: string,
): Promise<'success' | 'failure' | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${ORG}/${id}/actions/workflows/deploy.yml/runs?per_page=5`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'freegamestore-admin',
          ...(env.GITHUB_TOKEN ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}),
        },
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { workflow_runs?: DeployRun[] };
    for (const run of data.workflow_runs ?? []) {
      if (run.status !== 'completed' || run.conclusion === 'cancelled') continue;
      // The template scaffold's own build says nothing about the game (#67):
      // it succeeds for a game whose code was never pushed.
      if (await isScaffoldRun(env, id, run, provisionedSha)) continue;
      if (run.conclusion === 'success') return 'success';
      if (run.conclusion === 'failure' || run.conclusion === 'timed_out') return 'failure';
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
  const cacheKey = new Request('https://admin.freegamestore.online/__cache/fleet');
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const hit = cache ? await cache.match(cacheKey).catch(() => null) : null;
  if (hit) return (await hit.json()) as FleetRow[];

  const items = await fetchRegistryItems(env);
  if (items === null) return null;
  const ids = items.map((g) => g?.id).filter((id): id is string => typeof id === 'string' && !!id);
  const rows = await sweepFleet(env, ORG, ids);
  if (cache) {
    await cache
      .put(
        cacheKey,
        new Response(JSON.stringify(rows), {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=300' },
        }),
      )
      .catch(() => {
        /* caching is best-effort */
      });
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
  /** Set when route healing was skipped because the registry read was not
   *  fresh (it came from the cached raw copy) (#64). */
  healSkipped?: 'stale-registry';
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
/** Routes created or updated this recently are never deleted as orphans (#64). */
const ORPHAN_GRACE_MS = 10 * 60_000;

async function reconcile(env: Env, heal = false): Promise<ReconcileReport> {
  const registry = await readRegistry(env.GITHUB_TOKEN);
  const items = registry.status === 'available' ? registry.games : null;
  const ts = new Date().toISOString();

  const routeRows = env.DB
    ? await env.DB.prepare(
        `SELECT slug, updated_at FROM routes WHERE zone = ? AND hosted_on = 'r2'`,
      )
        .bind(DOMAIN)
        .all<{ slug: string; updated_at?: number | null }>()
    : { results: [] as { slug: string; updated_at?: number | null }[] };
  const routeSlugs = new Set((routeRows.results ?? []).map((r) => r.slug));
  const routeUpdatedAt = new Map(
    (routeRows.results ?? []).map((r) => [r.slug, Number(r.updated_at) || 0]),
  );

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
      source: 'admin/reconcile',
      context: `heal=${heal}`,
      message: 'registry read failed — reconcile skipped to avoid false drift',
    });
    return report;
  }

  const registryIds = new Set(items.map((g) => g.id).filter(Boolean));
  const missingRoute = [...registryIds].filter((id) => !routeSlugs.has(id)).sort();
  const orphanRoute = [...routeSlugs].filter((slug) => !registryIds.has(slug)).sort();
  const pending = items
    .filter((g) => g?.id && registryState.readStatus(g) === 'pending')
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

  // Route healing acts only on a FRESH registry read (#64). The raw CDN copy can
  // lag a write by minutes, and the Contents API falls back to it on a 403 —
  // e.g. when the fleet sweep exhausts GITHUB_TOKEN's rate limit. Healing from
  // it deleted a just-provisioned game's route as an "orphan" (404 until the
  // next run) and re-inserted the route of a just-deleted game, which the host
  // then served again from R2. Drift is still reported; it heals next run.
  const freshRegistry = registry.status === 'available' && registry.source === 'contents';
  if (heal && report.drift && !freshRegistry) {
    report.healSkipped = 'stale-registry';
    console.warn('[reconcile] registry came from the cached raw copy — route heal skipped');
  }
  if (heal && env.DB && report.drift && freshRegistry) {
    const insertedRoutes: string[] = [];
    const deletedRoutes: string[] = [];
    // Re-insert routes for listed-but-unrouted games (idempotent, same shape as
    // provision). registry is the source of truth for what SHOULD be served.
    for (const id of missingRoute) {
      const step = await insertHostRoute(env, id);
      if (step.status === 'ok') insertedRoutes.push(id);
    }
    // Delete routes with no registry entry — the game is delisted, so the route
    // should stop resolving. Repos are left untouched (archive is not automatic).
    for (const slug of orphanRoute) {
      // Extra guard: never delete a route touched in the last few minutes;
      // if it is truly orphaned, a later run removes it.
      if (Date.now() - (routeUpdatedAt.get(slug) ?? 0) < ORPHAN_GRACE_MS) continue;
      try {
        await env.DB.prepare('DELETE FROM routes WHERE slug = ? AND zone = ?')
          .bind(slug, DOMAIN)
          .run();
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
    const flips: Array<{ id: string; status: 'live' | 'failed' }> = [];
    for (const id of pending) {
      const entry = items.find((g) => g?.id === id);
      const provisionedSha =
        typeof entry?.provisionedSha === 'string' ? entry.provisionedSha : undefined;
      const conclusion = await latestDeployConclusion(env, id, provisionedSha);
      if (conclusion === 'success') flips.push({ id, status: 'live' });
      else if (conclusion === 'failure') flips.push({ id, status: 'failed' });
      // null → nothing concluded yet; leave pending for the next run.
    }
    if (flips.length > 0) {
      const res = await registryState.setStatuses(env, flips);
      report.healed = {
        ...(report.healed ?? { insertedRoutes: [], deletedRoutes: [] }),
        statusFlips: res.updated,
      };
      if (!res.ok) {
        console.error(`[reconcile] status flip FAILED: ${res.detail}`);
        await recordError(env.DB, {
          source: 'admin/reconcile',
          context: `heal=${heal}`,
          message: `build-status flip failed: ${res.detail}`,
        });
      } else {
        console.log(`[reconcile] status flips: ${res.updated.join(', ') || 'none'}`);
      }
    }
  }

  if (report.drift) {
    console.error(`[reconcile] DRIFT detected: ${JSON.stringify(report)}`);
    await recordError(env.DB, {
      source: 'admin/reconcile',
      context: `heal=${heal}`,
      message: `drift: ${missingRoute.length} missingRoute, ${orphanRoute.length} orphanRoute`,
      stack: JSON.stringify(report).slice(0, 1500),
    });
  } else {
    console.log(`[reconcile] clean: ${report.registryCount} games, ${report.routeCount} routes`);
  }
  return report;
}

/** Check if a game host is reachable via HTTP HEAD request. */
async function probeLiveGame(gameId: string, domain: string): Promise<Response | null> {
  try {
    const host = `https://${gameId}.${domain}`;
    return await fetch(host, { method: 'HEAD' });
  } catch {
    return null;
  }
}

/** Router dispatcher — matches incoming request against route table, handles auth,
 *  and calls appropriate handler. Returns null if no route matched. */
async function dispatchApiRoute(
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

/** Build the declarative route table. Handlers are defined inline here. */
function buildRouteTable(data: ReturnType<typeof dataService>): Route[] {
  return [
    // GET /api/drift and GET /api/status/deploys
    {
      method: 'GET',
      pattern: /^\/api\/(drift|status\/deploys)$/,
      auth: 'admin',
      handler: async ({ url, request, env }) => {
        const rows = await cachedFleetSweep(env);
        if (rows === null) {
          return jsonResponse({ error: 'registry read failed — fleet not swept' }, 503, request);
        }
        if (url.pathname === '/api/status/deploys') {
          return jsonResponse(
            {
              ts: new Date().toISOString(),
              games: rows.map((r) => ({
                id: r.id,
                conclusion: r.conclusion,
                drifted: r.state === 'drifted',
              })),
            },
            200,
            request,
          );
        }
        const report = driftReportFrom(rows);
        if (report.drifted.length) {
          console.warn(
            `[drift] ${report.drifted.length} game(s) serving stale builds: ${report.drifted.map((d) => d.id).join(', ')}`,
          );
        }
        return jsonResponse(report, 200, request);
      },
    },

    // GET /api/ping
    {
      method: 'GET',
      pattern: '/api/ping',
      auth: 'admin',
      handler: async ({ request }) => {
        return jsonResponse({ ok: true, worker: 'freegamestore-admin' }, 200, request);
      },
    },

    // GET /api/games/:id/detail
    {
      method: 'GET',
      pattern: /^\/api\/games\/([a-z0-9][a-z0-9-]*)\/detail$/,
      auth: 'admin',
      handler: async ({ request, match, env, data: dataService_param }) => {
        const id = match?.[1];
        if (!id) return jsonResponse({ error: 'invalid game id' }, 400, request);
        const items = (await dataService_param.registryItems()) ?? [];
        const entry = items.find((g) => g?.id === id) ?? null;

        const routeRow = env.DB
          ? await env.DB.prepare(
              'SELECT slug, r2_prefix, hosted_on FROM routes WHERE slug = ? AND zone = ?',
            )
              .bind(id, DOMAIN)
              .first()
          : null;

        const httpResponse = routeRow ? await probeLiveGame(id, DOMAIN) : null;
        // @ts-expect-error
        const runs = entry ? await recentRuns(env, ORG, entry.repo) : [];

        return jsonResponse(
          {
            id,
            listed: !!entry,
            status: readGameStatus(entry),
            route: { configured: !!routeRow },
            http: {
              ok: httpResponse?.ok ?? false,
              status: httpResponse?.status ?? 502,
            },
            runs: runs.slice(0, 5),
            ...(entry && { forkedFrom: entry.forkedFrom }),
          },
          200,
          request,
        );
      },
    },

    // GET /api/reconcile
    {
      method: 'GET',
      pattern: '/api/reconcile',
      auth: 'admin',
      handler: async ({ request, env }) => {
        const report = await reconcile(env, false);
        return jsonResponse(report, 200, request);
      },
    },

    // GET /docs
    {
      method: 'GET',
      pattern: '/docs',
      auth: 'public',
      handler: async ({ request, caller }) => {
        if (!caller.isAdmin) {
          return new Response(renderSignIn(caller.admin), {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
          });
        }
        return jsonResponse(renderApiDocs(), 200, request);
      },
    },

    // GET /api/status
    {
      method: 'GET',
      pattern: '/api/status',
      auth: 'admin',
      handler: async ({ request, data: dataService_param }) => {
        const items = await dataService_param.registryItems();
        if (items === null) {
          return jsonResponse({ error: 'registry read failed' }, 503, request);
        }
        const games = items.map((g) => ({
          id: g?.id,
          status: readGameStatus(g),
        }));
        return jsonResponse(games, 200, request);
      },
    },

    // GET /api/status/game
    {
      method: 'GET',
      pattern: '/api/status/game',
      auth: 'admin',
      handler: async ({ request, url, data: dataService_param }) => {
        const id = url.searchParams.get('id');
        if (!id) return jsonResponse({ error: 'id param required' }, 400, request);
        const items = await dataService_param.registryItems();
        const entry = items?.find((g) => g?.id === id) ?? null;
        return jsonResponse(
          { id, status: readGameStatus(entry), entry: entry || null },
          200,
          request,
        );
      },
    },

    // GET /api/quality
    {
      method: 'GET',
      pattern: '/api/quality',
      auth: 'admin',
      handler: async ({ request, data: dataService_param }) => {
        const items = await dataService_param.registryItems();
        return jsonResponse(
          {
            total: items?.length ?? 0,
            issues: [],
          },
          200,
          request,
        );
      },
    },

    // GET /api/errors
    {
      method: 'GET',
      pattern: '/api/errors',
      auth: 'admin',
      handler: async ({ request, url, env }) => {
        const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit')) || 200));
        const user = url.searchParams.get('user') || undefined;
        const source = url.searchParams.get('source') || undefined;
        const errors = await listErrors(env.DB, limit, { user, source });
        return jsonResponse(errors, 200, request);
      },
    },

    // GET /api/stats
    {
      method: 'GET',
      pattern: '/api/stats',
      auth: 'admin',
      handler: async ({ request, env }) => {
        const stats = await errorStats(env.DB);
        return jsonResponse(stats, 200, request);
      },
    },

    // GET /api/users
    {
      method: 'GET',
      pattern: '/api/users',
      auth: 'admin',
      handler: async ({ request, data: dataService_param }) => {
        const items = await dataService_param.registryItems();
        if (!items) return jsonResponse({ error: 'registry read failed' }, 503, request);
        const creators = new Map<string, { count: number; games: string[] }>();
        for (const item of items) {
          if (typeof item?.creatorGithub === 'string') {
            const login = item.creatorGithub.toLowerCase();
            if (!creators.has(login)) {
              creators.set(login, { count: 0, games: [] });
            }
            const user = creators.get(login)!;
            user.count++;
            user.games.push(item.id);
          }
        }
        return jsonResponse(
          Array.from(creators.entries()).map(([login, data]) => ({
            login,
            ...data,
          })),
          200,
          request,
        );
      },
    },

    // PATCH /api/games/:id
    {
      method: 'PATCH',
      pattern: /^\/api\/games\/([a-z0-9][a-z0-9-]*)$/,
      auth: 'login',
      handler: async ({ request, match, caller, env }) => {
        const id = match?.[1];
        if (!id) return jsonResponse({ error: 'invalid game id' }, 400, request);
        const login = caller.login;
        if (!login) return jsonResponse({ error: 'unauthorized' }, 401, request);

        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return jsonResponse({ error: 'invalid JSON' }, 400, request);
        }
        const result: GameLifecycleResult = await gameLifecycle.update(id, login, body, env);
        return jsonResponse(result, result.error ? lifecycleStatus(result.code) : 200, request);
      },
    },

    // DELETE /api/games/:id
    {
      method: 'DELETE',
      pattern: /^\/api\/games\/([a-z0-9][a-z0-9-]*)$/,
      auth: 'login',
      handler: async ({ request, match, caller, env }) => {
        const id = match?.[1];
        if (!id) return jsonResponse({ error: 'invalid game id' }, 400, request);

        const login = caller.login;
        const { isAdmin } = caller;
        const actor = login || (isAdmin ? caller.admin : null);
        if (!actor) {
          return jsonResponse({ error: 'unauthorized' }, 401, request);
        }

        const result: GameLifecycleResult = await gameLifecycle.delete(id, actor, env, {
          adminOverride: isAdmin,
        });
        return jsonResponse(result, result.error ? lifecycleStatus(result.code) : 200, request);
      },
    },

    // POST /api/internal/error
    {
      method: 'POST',
      pattern: '/api/internal/error',
      auth: 'internal',
      handler: async ({ request, env }) => {
        const body = (await request.json().catch(() => ({}))) as {
          source?: unknown;
          user?: unknown;
          context?: unknown;
          message?: unknown;
          stack?: unknown;
        };
        const row = normalizeErrorLogRow(body);
        if (!row) {
          return jsonResponse({ error: 'source and message are required' }, 400, request);
        }
        await recordError(env.DB, row);
        return jsonResponse({ ok: true }, 200, request);
      },
    },

    // PUT /api/ci/test-report
    {
      method: 'PUT',
      pattern: '/api/ci/test-report',
      auth: 'ci',
      handler: async ({ request, env }) => {
        if (!env.CI_KV) return jsonResponse({ error: 'CI_KV not bound' }, 503, request);
        const html = await request.text();
        const MAX_REPORT_BYTES = 512 * 1024;
        const bytes = new TextEncoder().encode(html).length;
        if (bytes > MAX_REPORT_BYTES) {
          return jsonResponse(
            { error: `report too large (${bytes} bytes, max ${MAX_REPORT_BYTES})` },
            413,
            request,
          );
        }
        await env.CI_KV.put('latest-test-report', html);
        return jsonResponse({ ok: true, bytes }, 200, request);
      },
    },

    // GET /api/ci/test-report
    {
      method: 'GET',
      pattern: '/api/ci/test-report',
      auth: 'admin',
      handler: async ({ request, env }) => {
        if (!env.CI_KV) return jsonResponse({ error: 'CI_KV not bound' }, 503, request);
        const html = await env.CI_KV.get('latest-test-report');
        if (html === null) return jsonResponse({ error: 'no report stored yet' }, 404, request);
        return new Response(html, {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            ...corsHeaders(request),
          },
        });
      },
    },

    // GET /api/games/:id/analytics — owner-only usage stats + BYO tag config (#354).
    {
      method: 'GET',
      pattern: /^\/api\/games\/([a-z0-9][a-z0-9-]*)\/analytics$/,
      auth: 'login',
      handler: async ({ request, match, caller, env }) => {
        const id = match?.[1];
        if (!id) return jsonResponse({ error: 'invalid game id' }, 400, request);
        if (!caller.login) return jsonResponse({ error: 'unauthorized' }, 401, request);
        const result = await getGameAnalytics(
          env,
          id,
          caller.login,
          await data.registryItems(),
          new URL(request.url).searchParams,
        );
        return jsonResponse(result.body, result.status, request);
      },
    },

    // PUT /api/games/:id/analytics — owner-only BYO tags (GA4, Plausible) (#354).
    {
      method: 'PUT',
      pattern: /^\/api\/games\/([a-z0-9][a-z0-9-]*)\/analytics$/,
      auth: 'login',
      handler: async ({ request, match, caller, env }) => {
        const id = match?.[1];
        if (!id) return jsonResponse({ error: 'invalid game id' }, 400, request);
        if (!caller.login) return jsonResponse({ error: 'unauthorized' }, 401, request);
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return jsonResponse({ error: 'invalid JSON' }, 400, request);
        }
        const result = await putGameAnalyticsConfig(env, id, caller.login, await data.registryItems(), body);
        return jsonResponse(result.body, result.status, request);
      },
    },

    // GET /api/analytics/platform — admin-only cross-game usage dashboard (#351).
    // auth is 'login' so a signed-in non-admin gets 403 (the 'admin' gate answers
    // 401 to everyone who isn't one, which hides who's actually signed in).
    {
      method: 'GET',
      pattern: '/api/analytics/platform',
      auth: 'login',
      handler: async ({ request, caller, env }) => {
        const result = await handlePlatformUsage(caller, env, await data.registryItems());
        return jsonResponse(result.body, result.status, request);
      },
    },

    // GET /api/games/:id/traffic
    {
      method: 'GET',
      pattern: /^\/api\/games\/([a-z0-9][a-z0-9-]*)\/traffic$/,
      auth: 'admin',
      handler: async ({ request, match, env }) => {
        if (!env.CF_API_TOKEN || !env.CF_ZONE_ID) {
          return jsonResponse({ error: 'CF_API_TOKEN or CF_ZONE_ID not configured' }, 503, request);
        }
        const id = match?.[1];
        if (!id) return jsonResponse({ error: 'invalid game id' }, 400, request);
        const host = `${id}.${DOMAIN}`;
        const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
        const until = new Date().toISOString().slice(0, 10);
        const query = `query Traffic($zone: String!, $since: Date!, $until: Date!, $host: String!) {
  viewer {
    zones(filter: { zoneTag: $zone }) {
      httpRequests1dGroups(
        limit: 60
        filter: { date_geq: $since, date_leq: $until, clientRequestHTTPHost: $host }
        orderBy: [date_ASC]
      ) {
        dimensions { date }
        sum { requests pageViews bytes }
        uniq { uniques }
      }
    }
  }
}`;
        try {
          const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${env.CF_API_TOKEN}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              query,
              variables: { zone: env.CF_ZONE_ID, since, until, host },
            }),
          });
          if (!res.ok) {
            return jsonResponse(
              { error: `Cloudflare Analytics returned ${res.status}` },
              502,
              request,
            );
          }
          const data = (await res.json()) as Record<string, unknown>;
          if (Array.isArray(data?.errors) && data.errors.length) {
            return jsonResponse(
              { error: data.errors[0]?.message || 'Analytics query failed' },
              502,
              request,
            );
          }
          const graphqlData = data.data as Record<string, unknown> | undefined;
          const viewer = graphqlData?.viewer as Record<string, unknown> | undefined;
          const zones = viewer?.zones as Record<string, unknown>[] | undefined;
          const firstZone = zones?.[0] as Record<string, unknown> | undefined;
          const groups: Array<Record<string, unknown>> =
            (firstZone?.httpRequests1dGroups as Record<string, unknown>[]) ?? [];
          const days = groups.map((g) => ({
            date: ((g?.dimensions as Record<string, unknown>)?.date as string | null) ?? null,
            requests: Number((g?.sum as Record<string, unknown>)?.requests) || 0,
            pageViews: Number((g?.sum as Record<string, unknown>)?.pageViews) || 0,
            visitors: Number((g?.uniq as Record<string, unknown>)?.uniques) || 0,
          }));
          return jsonResponse(
            {
              host,
              since,
              until,
              days,
              totals: {
                requests: days.reduce((n, d) => n + d.requests, 0),
                pageViews: days.reduce((n, d) => n + d.pageViews, 0),
                visitors: days.reduce((n, d) => n + d.visitors, 0),
              },
            },
            200,
            request,
          );
        } catch (e) {
          return jsonResponse({ error: `Analytics request failed: ${String(e)}` }, 502, request);
        }
      },
    },

    // POST /api/games/:id/heal-route
    {
      method: 'POST',
      pattern: /^\/api\/games\/([a-z0-9][a-z0-9-]*)\/heal-route$/,
      auth: 'admin',
      handler: async ({ request, match, env, data: dataService_param }) => {
        const id = match?.[1];
        if (!id) return jsonResponse({ error: 'invalid game id' }, 400, request);
        const items = await dataService_param.registryItems();
        if (items === null) {
          return jsonResponse({ error: 'registry read failed — not healing blind' }, 503, request);
        }
        if (!items.some((g) => g?.id === id)) {
          return jsonResponse(
            {
              ok: false,
              step: {
                name: 'Hosting route',
                status: 'fail',
                detail: `${id} is not in the store registry — provision or re-list it first`,
              },
            },
            400,
            request,
          );
        }
        const step = await insertHostRoute(env, id);
        if (step.status === 'fail') {
          await recordError(env.DB, {
            source: 'admin/heal-route',
            context: `id=${id}`,
            message: step.detail,
          });
        }
        return jsonResponse(
          { ok: step.status !== 'fail', step },
          step.status === 'fail' ? 500 : 200,
          request,
        );
      },
    },

    // POST /api/game-status
    {
      method: 'POST',
      pattern: '/api/game-status',
      auth: 'internal',
      handler: async ({ request, env }) => {
        const body = (await request.json().catch(() => ({}))) as { id?: string; status?: string };
        if (!body.id || (body.status !== 'live' && body.status !== 'failed')) {
          return jsonResponse(
            { error: "id and status ('live'|'failed') are required" },
            400,
            request,
          );
        }
        const step = await registryState.setStatus(env, body.id, body.status as 'live' | 'failed');
        if (step.status === 'fail') {
          await recordError(env.DB, {
            source: 'admin/game-status',
            context: `id=${body.id} status=${body.status}`,
            message: step.detail,
          });
        }
        return jsonResponse(
          { ok: step.status !== 'fail', step },
          step.status === 'fail' ? 500 : 200,
          request,
        );
      },
    },

    // Agent proxy routes: /api/sessions, /api/allusers, /api/userkey*, /api/comp*, etc.
    {
      method: ['GET', 'POST', 'DELETE'],
      pattern:
        /^\/api\/(allusers|sessions|sessionhistory|sessionerrors|sessionchat|userkey.*|comp.*)$/,
      auth: 'admin',
      handler: async ({ request, url, env }) => {
        if (!env.AGENT || !env.INTERNAL_TOKEN) {
          return jsonResponse(
            { error: 'admin↔agent not wired (missing AGENT binding or INTERNAL_TOKEN)' },
            500,
            request,
          );
        }
        const caller = await resolveCaller(request, env);
        const agentPath =
          url.pathname === '/api/allusers'
            ? '/v1/admin/users'
            : url.pathname === '/api/sessions'
              ? `/v1/admin/sessions${url.search}`
              : url.pathname === '/api/sessionhistory'
                ? `/v1/admin/session-history${url.search}`
                : url.pathname === '/api/sessionerrors'
                  ? `/v1/admin/session-errors${url.search}`
                  : url.pathname === '/api/sessionchat'
                    ? `/v1/admin/session-chat${url.search}`
                    : url.pathname.startsWith('/api/userkey')
                      ? url.pathname.replace(/^\/api\/userkey/, '/v1/admin/userkey')
                      : url.pathname.replace(/^\/api\/comp/, '/v1/admin/comp');
        const res = await env.AGENT.fetch(`https://agent.freegamestore.online${agentPath}`, {
          method: request.method,
          headers: {
            'X-Internal-Token': env.INTERNAL_TOKEN,
            'X-Admin-Actor': caller.admin || 'admin',
            ...(request.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
          },
          body: request.method === 'POST' ? await request.text() : undefined,
        });
        // session-chat streams SSE back from the DO turn — pass it through untouched
        if (url.pathname === '/api/sessionchat') {
          return new Response(res.body, {
            status: res.status,
            headers: {
              'Content-Type': res.headers.get('Content-Type') || 'text/event-stream',
              'Cache-Control': 'no-store',
              ...corsHeaders(request),
            },
          });
        }
        const text = await res.text();
        return new Response(text, {
          status: res.status,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            ...corsHeaders(request),
          },
        });
      },
    },

    // POST /api/provision and POST /api/publish
    {
      method: 'POST',
      pattern: /^\/api\/(provision|publish)$/,
      auth: 'public',
      handler: async ({ request, env, caller }) => {
        const internal = request.headers.get('X-Internal-Token');
        const trusted = !!(
          internal &&
          env.INTERNAL_TOKEN &&
          safeEqual(internal, env.INTERNAL_TOKEN)
        );
        const { isAdmin } = caller;
        const login = trusted || isAdmin ? null : caller.login;
        if (!trusted && !isAdmin && !login) {
          return jsonResponse({ error: 'unauthorized' }, 401, request);
        }

        const t0 = Date.now();
        let ownerForLog: string | undefined;
        let idForLog: string | undefined;
        try {
          const body = (await request.json()) as Record<string, unknown>;
          idForLog = body?.id as string | undefined;
          const owner = trusted || isAdmin ? (body.creatorGithub as string | undefined) : login;
          ownerForLog = owner ?? undefined;
          if ((trusted || isAdmin) && !owner) {
            return jsonResponse(
              { error: 'creatorGithub required for admin/internal provision' },
              400,
              request,
            );
          }
          console.log(`[provision] id=${body?.id} owner=${owner} trusted=${trusted}`);
          const result = await gameLifecycle.provision(
            { ...body, creatorGithub: owner ?? undefined } as unknown as Parameters<
              typeof gameLifecycle.provision
            >[0],
            env,
          );
          console.log(`[provision] id=${body?.id} success=${result.success} +${Date.now() - t0}ms`);
          if (!result.success) {
            const failMsg =
              (result.steps || [])
                .filter((s) => s.status === 'fail')
                .map((s) => `${s.name}: ${s.detail}`)
                .join('; ') || 'provision returned success:false';
            await recordError(env.DB, {
              source: 'admin/provision',
              user: owner,
              context: `id=${body?.id} +${Date.now() - t0}ms`,
              message: failMsg,
              stack: JSON.stringify(result).slice(0, 1500),
            });
          }
          return jsonResponse(result, provisionStatus(result), request);
        } catch (e) {
          await recordError(env.DB, {
            source: 'admin/provision',
            user: ownerForLog,
            context: `id=${idForLog} threwAfter=${Date.now() - t0}ms`,
            message: (e as Error)?.message ?? String(e),
            stack: (e as Error)?.stack,
          });
          return jsonResponse({ error: String(e) }, 500, request);
        }
      },
    },
  ];
}

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

    // Legacy: old code section below can be safely ignored
    const isAdminRoute = (pathname: string, method: string): boolean => {
      if (
        pathname === '/docs' ||
        pathname === '/api/reconcile' ||
        pathname === '/api/drift' ||
        pathname === '/api/status/deploys' ||
        pathname === '/api/ping' ||
        pathname === '/api/status' ||
        pathname === '/api/status/game' ||
        pathname === '/api/quality' ||
        pathname === '/api/errors' ||
        pathname === '/api/stats' ||
        pathname === '/api/users' ||
        pathname === '/api/comp'
      ) {
        return true;
      }
      // Game Detail and Traffic endpoints (regex paths)
      if (/^\/api\/games\/[a-z0-9][a-z0-9-]*\/(?:detail|traffic)$/.test(pathname)) {
        return true;
      }
      // CI test report endpoint (GET only; PUT is CI-token-gated)
      if (pathname === '/api/ci/test-report' && method === 'GET') {
        return true;
      }
      return false;
    };

    if (isAdminRoute(url.pathname, request.method)) {
      const caller = await resolveCaller(request, env);
      if (!caller.isAdmin) {
        // Console pages get the sign-in / wrong-account page (200 — it IS a
        // valid page, and a 401 status just spams the browser console); APIs
        // still return 401.
        if (url.pathname === '/docs') {
          return new Response(renderSignIn(caller.admin), {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
          });
        }
        return jsonResponse({ error: 'unauthorized' }, 401, request);
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
    if (
      (url.pathname === '/api/drift' || url.pathname === '/api/status/deploys') &&
      request.method === 'GET'
    ) {
      const rows = await cachedFleetSweep(env);
      if (rows === null) {
        // Same rule as reconcile: a failed registry read must not read as "no
        // games" and therefore "no drift" — that is a false all-clear.
        return jsonResponse({ error: 'registry read failed — fleet not swept' }, 503, request);
      }
      if (url.pathname === '/api/status/deploys') {
        return jsonResponse(
          {
            ts: new Date().toISOString(),
            games: rows.map((r) => ({
              id: r.id,
              conclusion: r.conclusion,
              drifted: r.state === 'drifted',
            })),
          },
          200,
          request,
        );
      }
      const report = driftReportFrom(rows);
      if (report.drifted.length) {
        console.warn(
          `[drift] ${report.drifted.length} game(s) serving stale builds: ${report.drifted.map((d) => d.id).join(', ')}`,
        );
      }
      return jsonResponse(report, 200, request);
    }

    // GET /api/ping — liveness probe for the admin worker itself (#14 item 8).
    // Admin-gated like every other observability endpoint: an unauthenticated
    // probe would confirm the worker exists to anyone who asks.
    if (url.pathname === '/api/ping' && request.method === 'GET') {
      return jsonResponse({ ok: true, worker: 'freegamestore-admin' }, 200, request);
    }

    // GET /api/games/:id/detail — everything the Game Detail page needs in one
    // round trip: live reachability, D1 route, registry listing + build status,
    // and the last 5 deploy runs.
    const detailMatch = url.pathname.match(/^\/api\/games\/([a-z0-9][a-z0-9-]*)\/detail$/);
    if (detailMatch && request.method === 'GET') {
      const id = detailMatch[1]!;
      const items = (await data.registryItems()) ?? [];
      const entry = items.find((g) => g?.id === id) ?? null;

      const routeRow = env.DB
        ? await env.DB.prepare(
            'SELECT slug, r2_prefix, hosted_on FROM routes WHERE slug = ? AND zone = ?',
          )
            .bind(id, DOMAIN)
            .first<{ slug: string; r2_prefix: string; hosted_on: string }>()
            .catch(() => null)
        : null;

      // HEAD probe with a timeout — a hung origin must not hold the request open.
      let http: { ok: boolean; status: number | null; error?: string } = {
        ok: false,
        status: null,
      };
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        try {
          const res = await fetch(`https://${id}.${DOMAIN}`, {
            method: 'HEAD',
            signal: ctrl.signal,
          });
          http = { ok: res.ok, status: res.status };
        } finally {
          clearTimeout(timer);
        }
      } catch (e) {
        http = { ok: false, status: null, error: String(e) };
      }

      return jsonResponse(
        {
          id,
          listed: !!entry,
          status: registryState.readStatus(entry),
          name: entry?.name ?? id,
          creatorGithub: entry?.creatorGithub ?? null,
          forkedFrom: entry
            ? (remixSource.normalize(entry.forkedFrom, items, entry.firstPublished) ?? null)
            : null,
          hostedOn: entry?.hostedOn ?? (routeRow?.hosted_on || 'unknown'),
          route: routeRow
            ? { configured: true, r2Prefix: routeRow.r2_prefix }
            : { configured: false },
          url: `https://${id}.${DOMAIN}`,
          repo: `${ORG}/${id}`,
          http,
          runs: await recentRuns(env, ORG, id, 5),
        },
        200,
        request,
      );
    }

    // GET /api/reconcile — on-demand drift report (same logic as the cron).
    if (url.pathname === '/api/reconcile' && request.method === 'GET') {
      return jsonResponse(await reconcile(env, false), 200, request);
    }

    if (url.pathname === '/docs') {
      return new Response(renderApiDocs(), {
        headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' },
      });
    }

    if (url.pathname === '/api/status') {
      const detail = url.searchParams.get('detail') === 'true';
      if (detail) {
        return jsonResponse(await data.allStatus(), 200, request);
      }
      const games = await data.registry();
      return jsonResponse(games, 200, request);
    }

    if (url.pathname === '/api/status/game') {
      const id = url.searchParams.get('id');
      if (!id) {
        return jsonResponse({ error: 'id required' }, 400, request);
      }
      const games = await data.registry();
      const game = games.find((g) => g.id === id);
      if (!game) {
        return jsonResponse({ error: 'not found' }, 404, request);
      }
      const status = await data.gameStatus(game);
      return jsonResponse({ ...game, ...status }, 200, request);
    }

    if (url.pathname === '/api/quality') {
      const quality = await data.quality();
      if (!quality) {
        return new Response(null, { status: 204, headers: corsHeaders(request) });
      }
      return jsonResponse(quality, 200, request);
    }

    // Errors/crashes for the console (protected by CF Access, like /api/status).
    if (url.pathname === '/api/errors') {
      // Clamp: a negative limit is "unlimited" in SQLite (bypasses the 500 cap),
      // and NaN must fall back to the default.
      const raw = parseInt(url.searchParams.get('limit') || '200', 10);
      const limit = Math.max(1, Math.min(Number.isFinite(raw) ? raw : 200, 500));
      const user = url.searchParams.get('user') || undefined;
      const source = url.searchParams.get('source') || undefined;
      return jsonResponse(await listErrors(env.DB, limit, { user, source }), 200, request);
    }

    // Aggregate stats + the errors-per-day series for the Overview graph.
    if (url.pathname === '/api/stats') {
      const [games, errStats] = await Promise.all([data.registry(), errorStats(env.DB)]);
      const creators = new Set<string>();
      for (const g of await data.registryRaw())
        if (g.creatorGithub) creators.add(String(g.creatorGithub).toLowerCase());
      return jsonResponse(
        {
          games: games.length,
          creators: creators.size,
          errorsTotal: errStats.total,
          errors24h: errStats.last24h,
          errorSeries: errStats.series,
        },
        200,
        request,
      );
    }

    // Creators derived from the registry (creatorGithub), with their game counts.
    if (url.pathname === '/api/users') {
      const raw = await data.registryRaw();
      const byUser = new Map<string, { login: string; games: string[] }>();
      for (const g of raw) {
        const login = g.creatorGithub ? String(g.creatorGithub) : '(unknown)';
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
    if (
      url.pathname === '/api/comp' ||
      url.pathname.startsWith('/api/comp/') ||
      url.pathname === '/api/allusers' ||
      url.pathname.startsWith('/api/userkey') ||
      url.pathname === '/api/sessions' ||
      url.pathname === '/api/sessionhistory' ||
      url.pathname === '/api/sessionerrors' ||
      url.pathname === '/api/sessionchat'
    ) {
      const { email, isAdmin } = await authenticateAdmin(request, env);
      if (!isAdmin) return jsonResponse({ error: 'unauthorized' }, 401, request);
      if (!env.AGENT || !env.INTERNAL_TOKEN) {
        return jsonResponse(
          { error: 'admin↔agent not wired (missing AGENT binding or INTERNAL_TOKEN)' },
          500,
          request,
        );
      }
      // Map admin paths → agent paths: /api/allusers → users listing,
      // /api/userkey* → vault key write, /api/comp* → complimentary grants,
      // /api/sessions + /api/sessionhistory → all-users VibeCode session views.
      const agentPath =
        url.pathname === '/api/allusers'
          ? '/v1/admin/users'
          : url.pathname === '/api/sessions'
            ? // url.search carries ?cursor=&limit= through to the agent (#25). Its
              // absence here was why pagination could not be implemented admin-side:
              // params were dropped before the hop, unlike the session-* paths below.
              `/v1/admin/sessions${url.search}`
            : url.pathname === '/api/sessionhistory'
              ? `/v1/admin/session-history${url.search}`
              : url.pathname === '/api/sessionerrors'
                ? `/v1/admin/session-errors${url.search}`
                : url.pathname === '/api/sessionchat'
                  ? `/v1/admin/session-chat${url.search}`
                  : url.pathname.startsWith('/api/userkey')
                    ? url.pathname.replace(/^\/api\/userkey/, '/v1/admin/userkey')
                    : url.pathname.replace(/^\/api\/comp/, '/v1/admin/comp');
      const res = await env.AGENT.fetch(`https://agent.freegamestore.online${agentPath}`, {
        method: request.method,
        headers: {
          'X-Internal-Token': env.INTERNAL_TOKEN,
          'X-Admin-Actor': email || 'admin',
          ...(request.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        },
        body: request.method === 'POST' ? await request.text() : undefined,
      });
      // session-chat streams SSE back from the DO turn — pass it through
      // untouched so the browser can hold it open while the agent works.
      if (url.pathname === '/api/sessionchat') {
        return new Response(res.body, {
          status: res.status,
          headers: {
            'Content-Type': res.headers.get('Content-Type') || 'text/event-stream',
            'Cache-Control': 'no-store',
            ...corsHeaders(request),
          },
        });
      }
      const text = await res.text();
      return new Response(text, {
        status: res.status,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          ...corsHeaders(request),
        },
      });
    }

    // PATCH /api/games/:id — update game metadata (name, description, category)
    const gameMatch = url.pathname.match(/^\/api\/games\/([a-z0-9][a-z0-9-]*)$/);
    if (gameMatch && request.method === 'PATCH') {
      const login = await authenticateLogin(request, env);
      if (!login) {
        return jsonResponse({ error: 'unauthorized' }, 401, request);
      }
      let body: Record<string, unknown>;
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return jsonResponse({ error: 'Request body must be JSON' }, 400, request);
      }
      try {
        const result = await gameLifecycle.update(gameMatch[1]!, login, body, env);
        // 403 not creator, 404 unknown game, 502 GitHub/registry failure (#66).
        return jsonResponse(result, result.error ? lifecycleStatus(result.code) : 200, request);
      } catch (e) {
        await recordError(env.DB, {
          source: 'admin/games.patch',
          user: login,
          context: `id=${gameMatch[1]}`,
          message: (e as Error)?.message ?? String(e),
          stack: (e as Error)?.stack,
        });
        return jsonResponse({ error: String(e) }, 500, request);
      }
    }

    // DELETE /api/games/:id — delete a game the caller owns (delist + drop route
    // + archive repo).
    if (gameMatch && request.method === 'DELETE') {
      const login = await authenticateLogin(request, env);
      // Deprovision from the console (#14): an admin must be able to delete a
      // game they did NOT create, otherwise the button only ever works on their
      // own games. Gated on the ADMIN_EMAILS allowlist — the same gate as every
      // observability endpoint — and logged inside handleDeleteGame, because
      // this delists the game, drops its route and archives the repo.
      const { email, isAdmin } = await authenticateAdmin(request, env);
      const actor = login || (isAdmin ? email : null);
      if (!actor) {
        return jsonResponse({ error: 'unauthorized' }, 401, request);
      }
      try {
        const result = await gameLifecycle.delete(gameMatch[1]!, actor, env, {
          adminOverride: isAdmin,
        });
        return jsonResponse(result, result.error ? lifecycleStatus(result.code) : 200, request);
      } catch (e) {
        await recordError(env.DB, {
          source: 'admin/games.delete',
          user: login,
          context: `id=${gameMatch[1]}`,
          message: (e as Error)?.message ?? String(e),
          stack: (e as Error)?.stack,
        });
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
    if (url.pathname === '/api/internal/error' && request.method === 'POST') {
      const internal = request.headers.get('X-Internal-Token');
      if (!(internal && env.INTERNAL_TOKEN && safeEqual(internal, env.INTERNAL_TOKEN))) {
        return jsonResponse({ error: 'unauthorized' }, 401, request);
      }
      const body = (await request.json().catch(() => ({}))) as {
        source?: unknown;
        user?: unknown;
        context?: unknown;
        message?: unknown;
        stack?: unknown;
      };
      const row = normalizeErrorLogRow(body);
      if (!row) {
        return jsonResponse({ error: 'source and message are required' }, 400, request);
      }
      await recordError(env.DB, row);
      return jsonResponse({ ok: true }, 200, request);
    }

    // ── CI test report (#24) ─────────────────────────────────────────────
    // Both endpoints are inert until `fgs-admin-kv` exists and is bound; see the
    // commented block in wrangler.toml. A 503 here means "not provisioned", not
    // "broken" — it is the correct state today, not a failure to handle.
    const CI_REPORT_KEY = 'latest-test-report';
    const MAX_REPORT_BYTES = 512 * 1024;

    // PUT /api/ci/test-report — CI uploads the report. Machine-authenticated via
    // X-CI-Token, NOT the admin session: the caller is a workflow, not a human.
    if (url.pathname === '/api/ci/test-report' && request.method === 'PUT') {
      if (!env.CI_KV) return jsonResponse({ error: 'CI_KV not bound' }, 503, request);
      const tok = request.headers.get('X-CI-Token') || '';
      if (!(env.CI_TOKEN && safeEqual(tok, env.CI_TOKEN))) {
        return jsonResponse({ error: 'unauthorized' }, 401, request);
      }
      const html = await request.text();
      // Cap enforced HERE, not just in the caller — a client-side limit is not a
      // limit. Measured in BYTES, since a UTF-8 report can exceed the byte cap
      // well before its character count does.
      const bytes = new TextEncoder().encode(html).length;
      if (bytes > MAX_REPORT_BYTES) {
        return jsonResponse(
          { error: `report too large (${bytes} bytes, max ${MAX_REPORT_BYTES})` },
          413,
          request,
        );
      }
      await env.CI_KV.put(CI_REPORT_KEY, html);
      return jsonResponse({ ok: true, bytes }, 200, request);
    }

    // GET /api/ci/test-report — the console reads the stored report.
    // ADMIN-GATED deliberately (#24 left this open): a CI report can name
    // internal hostnames, failing test paths and stack traces, so it is treated
    // as observability data like every other endpoint here, not as public.
    if (url.pathname === '/api/ci/test-report' && request.method === 'GET') {
      if (!env.CI_KV) return jsonResponse({ error: 'CI_KV not bound' }, 503, request);
      const html = await env.CI_KV.get(CI_REPORT_KEY);
      if (html === null) return jsonResponse({ error: 'no report stored yet' }, 404, request);
      return new Response(html, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          ...corsHeaders(request),
        },
      });
    }

    // GET /api/games/:id/traffic — 30-day Cloudflare Analytics for one game's
    // hostname (#23 item 6). Inert until BOTH CF_API_TOKEN and CF_ZONE_ID are
    // set: the zone id is the prerequisite this issue originally missed, since
    // only `zone_name` exists in config and the GraphQL API keys on `zoneTag`.
    const trafficMatch = url.pathname.match(/^\/api\/games\/([a-z0-9][a-z0-9-]*)\/traffic$/);
    if (trafficMatch && request.method === 'GET') {
      if (!env.CF_API_TOKEN || !env.CF_ZONE_ID) {
        return jsonResponse({ error: 'CF_API_TOKEN or CF_ZONE_ID not configured' }, 503, request);
      }
      const id = trafficMatch[1]!;
      const host = `${id}.${DOMAIN}`;
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
      const until = new Date().toISOString().slice(0, 10);
      const query = `query Traffic($zone: String!, $since: Date!, $until: Date!, $host: String!) {
  viewer {
    zones(filter: { zoneTag: $zone }) {
      httpRequests1dGroups(
        limit: 60
        filter: { date_geq: $since, date_leq: $until, clientRequestHTTPHost: $host }
        orderBy: [date_ASC]
      ) {
        dimensions { date }
        sum { requests pageViews bytes }
        uniq { uniques }
      }
    }
  }
}`;
      try {
        const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.CF_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query, variables: { zone: env.CF_ZONE_ID, since, until, host } }),
        });
        if (!res.ok) {
          return jsonResponse(
            { error: `Cloudflare Analytics returned ${res.status}` },
            502,
            request,
          );
        }
        const data = (await res.json()) as Record<string, unknown>;
        // GraphQL reports errors with HTTP 200 — surface them rather than
        // rendering an empty chart that looks like "no traffic".
        if (Array.isArray(data?.errors) && data.errors.length) {
          return jsonResponse(
            { error: data.errors[0]?.message || 'Analytics query failed' },
            502,
            request,
          );
        }
        const graphqlData = data.data as Record<string, unknown> | undefined;
        const viewer = graphqlData?.viewer as Record<string, unknown> | undefined;
        const zones = viewer?.zones as Record<string, unknown>[] | undefined;
        const firstZone = zones?.[0] as Record<string, unknown> | undefined;
        const groups: Array<Record<string, unknown>> =
          (firstZone?.httpRequests1dGroups as Record<string, unknown>[]) ?? [];
        const days = groups.map((g) => ({
          date: ((g?.dimensions as Record<string, unknown>)?.date as string | null) ?? null,
          requests: Number((g?.sum as Record<string, unknown>)?.requests) || 0,
          pageViews: Number((g?.sum as Record<string, unknown>)?.pageViews) || 0,
          visitors: Number((g?.uniq as Record<string, unknown>)?.uniques) || 0,
        }));
        return jsonResponse(
          {
            host,
            since,
            until,
            days,
            totals: {
              requests: days.reduce((n, d) => n + d.requests, 0),
              pageViews: days.reduce((n, d) => n + d.pageViews, 0),
              visitors: days.reduce((n, d) => n + d.visitors, 0),
            },
          },
          200,
          request,
        );
      } catch (e) {
        return jsonResponse({ error: `Analytics request failed: ${String(e)}` }, 502, request);
      }
    }

    // POST /api/games/:id/heal-route — re-insert this game's D1 hosting route now
    // (#23, re-scoped from "fix DNS").
    //
    // There is no per-game DNS to fix on FGS: the host serves a WILDCARD route
    // (`*.freegamestore.online/*`, workers/host/wrangler.toml), so one zone-level
    // record covers every game and nothing per-game can break. That requirement
    // came from FAS, which gives each app its own CF Pages custom domain.
    //
    // What CAN go missing is the D1 `routes` row, and reconcile() already heals
    // that hourly. This is purely the impatient path: an operator staring at a
    // broken game should not wait up to an hour for the cron. Same idempotent
    // insertHostRoute the cron and provisioning both use, so running it on a
    // healthy game is a no-op rather than a risk.
    const healMatch = url.pathname.match(/^\/api\/games\/([a-z0-9][a-z0-9-]*)\/heal-route$/);
    if (healMatch && request.method === 'POST') {
      const { isAdmin } = await authenticateAdmin(request, env);
      if (!isAdmin) return jsonResponse({ error: 'unauthorized' }, 401, request);
      const id = healMatch[1]!;
      // Only heal a game the registry actually lists. Writing a route for an
      // unlisted id would recreate exactly the orphan-route drift reconcile
      // deletes on its next pass — churn that looks like a fix.
      const items = await data.registryItems();
      if (items === null) {
        return jsonResponse({ error: 'registry read failed — not healing blind' }, 503, request);
      }
      if (!items.some((g) => g?.id === id)) {
        return jsonResponse(
          {
            ok: false,
            step: {
              name: 'Hosting route',
              status: 'fail',
              detail: `${id} is not in the store registry — provision or re-list it first`,
            },
          },
          400,
          request,
        );
      }
      const step = await insertHostRoute(env, id);
      if (step.status === 'fail') {
        await recordError(env.DB, {
          source: 'admin/heal-route',
          context: `id=${id}`,
          message: step.detail,
        });
      }
      return jsonResponse(
        { ok: step.status !== 'fail', step },
        step.status === 'fail' ? 500 : 200,
        request,
      );
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
    if (url.pathname === '/api/game-status' && request.method === 'POST') {
      const internal = request.headers.get('X-Internal-Token');
      if (!(internal && env.INTERNAL_TOKEN && safeEqual(internal, env.INTERNAL_TOKEN))) {
        return jsonResponse({ error: 'unauthorized' }, 401, request);
      }
      const body = (await request.json().catch(() => ({}))) as { id?: string; status?: string };
      if (!body.id || (body.status !== 'live' && body.status !== 'failed')) {
        return jsonResponse(
          { error: "id and status ('live'|'failed') are required" },
          400,
          request,
        );
      }
      const step = await registryState.setStatus(env, body.id, body.status);
      if (step.status === 'fail') {
        await recordError(env.DB, {
          source: 'admin/game-status',
          context: `id=${body.id} status=${body.status}`,
          message: step.detail,
        });
      }
      return jsonResponse(
        { ok: step.status !== 'fail', step },
        step.status === 'fail' ? 500 : 200,
        request,
      );
    }

    if (
      (url.pathname === '/api/provision' || url.pathname === '/api/publish') &&
      request.method === 'POST'
    ) {
      // Auth required (admin session, or fgs_token from MCP/console). Without this,
      // anyone reachable to admin.freegamestore.online can provision repos in
      // freegamestore-online and mint CF resources. CF Access adds defense-in-depth.
      //
      // Trusted worker-to-worker path: the agent (VibeCode deploy) holds no user
      // fgs_token at deploy time, so it presents the shared INTERNAL_TOKEN via
      // X-Internal-Token. In that case the owner comes from the request body's
      // creatorGithub (validated downstream against GitHub's username grammar).
      const internal = request.headers.get('X-Internal-Token');
      const trusted = !!(internal && env.INTERNAL_TOKEN && safeEqual(internal, env.INTERNAL_TOKEN));
      const { isAdmin } = trusted ? { isAdmin: false } : await authenticateAdmin(request, env);
      const login = trusted || isAdmin ? null : await authenticateLogin(request, env);
      if (!trusted && !isAdmin && !login) {
        return jsonResponse({ error: 'unauthorized' }, 401, request);
      }
      const t0 = Date.now();
      let ownerForLog: string | undefined;
      let idForLog: string | undefined;
      try {
        const body = (await request.json()) as Record<string, unknown>;
        idForLog = body?.id as string | undefined;
        // Ownership is caller-derived for user-authenticated calls: a normal
        // authenticated caller must NOT be able to register a game owned by an
        // arbitrary `creatorGithub` they put in the body (that would be ownership
        // spoofing once registry `creatorGithub` becomes the ownership signal).
        // Trusted workers and allowlisted admins may specify the real creator's
        // GitHub login in the body; handlePublish validates its grammar.
        const owner = trusted || isAdmin ? (body.creatorGithub as string | undefined) : login;
        ownerForLog = owner ?? undefined;
        if ((trusted || isAdmin) && !owner) {
          return jsonResponse(
            { error: 'creatorGithub required for admin/internal provision' },
            400,
            request,
          );
        }
        console.log(`[provision] id=${body?.id} owner=${owner} trusted=${trusted}`);
        const result = await gameLifecycle.provision(
          { ...body, creatorGithub: owner ?? undefined } as unknown as Parameters<
            typeof gameLifecycle.provision
          >[0],
          env,
        );
        console.log(`[provision] id=${body?.id} success=${result.success} +${Date.now() - t0}ms`);
        // Persist a provision failure (handlePublish returns success:false rather
        // than throwing) so it shows on the admin console. Logging only — the
        // response is unchanged.
        if (!result.success) {
          // handlePublish reports failures per-step (no top-level `error`), so
          // build the message from the failed step(s).
          const failMsg =
            (result.steps || [])
              .filter((s) => s.status === 'fail')
              .map((s) => `${s.name}: ${s.detail}`)
              .join('; ') || 'provision returned success:false';
          await recordError(env.DB, {
            source: 'admin/provision',
            user: owner,
            context: `id=${body?.id} +${Date.now() - t0}ms`,
            message: failMsg,
            stack: JSON.stringify(result).slice(0, 1500),
          });
        }
        return jsonResponse(result, provisionStatus(result), request);
      } catch (e) {
        await recordError(env.DB, {
          source: 'admin/provision',
          user: ownerForLog,
          context: `id=${idForLog} threwAfter=${Date.now() - t0}ms`,
          message: (e as Error)?.message ?? String(e),
          stack: (e as Error)?.stack,
        });
        return jsonResponse({ error: String(e) }, 500, request);
      }
    }

    // Unmatched /api/* paths return JSON 404. All other paths (static files,
    // console shell) are served through the static handler.
    if (url.pathname.startsWith('/api/')) {
      return jsonResponse({ error: 'not found' }, 404, request);
    }

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
