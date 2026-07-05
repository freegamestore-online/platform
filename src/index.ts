import { handleDeleteGame, handlePublish, handleUpdateGame, insertHostRoute, renderProvisionForm } from "./publish";
import { errorStats, listErrors, pruneErrors, recordError } from "./errlog";
import { verifySession, handleAuthExchange, handleAuthMe } from "./auth";

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

function renderDashboardShell(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Admin -- FreeGameStore</title>
  <script>try{var _v=localStorage.getItem('fgs_admin_textsize');if(_v){document.documentElement.style.fontSize=({sm:14,md:16,lg:18,xl:20}[_v]||16)+'px'}}catch(e){}</script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f0f0f; color: #e5e5e5; padding: 2rem; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    .meta { color: #888; font-size: 0.85rem; margin-bottom: 1.5rem; }
    .stats { display: flex; gap: 1rem; margin-bottom: 2rem; flex-wrap: wrap; }
    .stat { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 0.75rem; padding: 1rem 1.5rem; }
    .stat .num { font-size: 2rem; font-weight: 700; }
    .stat .label { font-size: 0.8rem; color: #888; }
    h2 { font-size: 1.2rem; margin: 2rem 0 0.75rem; padding-bottom: 0.5rem; border-bottom: 1px solid #2a2a2a; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    th { text-align: left; padding: 0.5rem; color: #888; font-weight: 600; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #2a2a2a; }
    td { padding: 0.6rem 0.5rem; border-bottom: 1px solid #1a1a1a; vertical-align: top; }
    tr:hover { background: #1a1a1a; }
    a { color: #34d399; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .green { color: #34d399; }
    .red { color: #f87171; }
    .yellow { color: #fbbf24; }
    .gray { color: #888; }
    .refresh { background: #10b981; color: white; border: none; padding: 0.5rem 1rem; border-radius: 0.5rem; cursor: pointer; font-size: 0.85rem; }
    .refresh:hover { background: #059669; }
    .loading { color: #fbbf24; }
    .filter-chip { background: #1a1a1a; border: 1px solid #2a2a2a; color: #888; padding: 0.25rem 0.6rem; border-radius: 1rem; cursor: pointer; font-size: 0.75rem; }
    .filter-chip.active { background: #10b981; border-color: #10b981; color: white; }
    .letter-btn { background: #1a1a1a; border: 1px solid #2a2a2a; color: #888; width: 1.5rem; height: 1.5rem; border-radius: 0.25rem; cursor: pointer; font-size: 0.7rem; display: flex; align-items: center; justify-content: center; }
    .letter-btn.active { background: #10b981; border-color: #10b981; color: white; }
    .quality-score { font-weight: 700; font-size: 0.9rem; }
    .q-green { color: #34d399; }
    .q-yellow { color: #fbbf24; }
    .q-red { color: #f87171; }
    .q-gray { color: #555; }
    .tabs { display: flex; gap: 0.25rem; margin-bottom: 1.5rem; border-bottom: 1px solid #2a2a2a; flex-wrap: wrap; }
    .tab { background: none; border: none; color: #888; padding: 0.6rem 1rem; cursor: pointer; font-size: 0.9rem; border-bottom: 2px solid transparent; font-family: inherit; }
    .tab.active { color: #34d399; border-bottom-color: #34d399; }
    .tabpanel { display: none; }
    .tabpanel.active { display: block; }
    .bar { display: inline-block; border-radius: 2px 2px 0 0; min-height: 1px; transition: height 0.2s; }
    .src-tag { font-size: 0.7rem; padding: 0.1rem 0.4rem; border-radius: 0.25rem; background: #2a2a2a; color: #ccc; white-space: nowrap; }
    pre.stack { white-space: pre-wrap; font-size: 0.72rem; color: #fca5a5; margin-top: 0.35rem; max-height: 9rem; overflow: auto; background: #140f0f; padding: 0.5rem; border-radius: 0.35rem; }
    /* Sticky top nav (breaks out of the body's 2rem padding to sit flush). */
    .topnav { position: sticky; top: 0; z-index: 50; margin: -2rem -2rem 1.5rem; padding: 0.6rem 1.5rem; display: flex; align-items: center; gap: 1rem; background: #141414; border-bottom: 1px solid #2a2a2a; }
    .brand { font-weight: 800; font-size: 1.05rem; letter-spacing: -0.01em; }
    .brand .accent { color: #34d399; }
    .brand .tag { color: #888; font-weight: 600; font-size: 0.68rem; border: 1px solid #2a2a2a; padding: 0.1rem 0.4rem; border-radius: 0.35rem; margin-left: 0.5rem; text-transform: uppercase; letter-spacing: 0.06em; vertical-align: middle; }
    .navlinks { display: flex; align-items: center; gap: 0.25rem; margin-left: auto; }
    .navlinks .refresh { margin-left: 0.5rem; }
    .sizesel { background: #1a1a1a; color: #e5e5e5; border: 1px solid #2a2a2a; border-radius: 0.4rem; padding: 0.35rem 0.4rem; font-size: 0.8rem; font-family: inherit; cursor: pointer; }
    .hamburger { display: none; margin-left: auto; background: none; border: 1px solid #2a2a2a; color: #e5e5e5; border-radius: 0.4rem; padding: 0.3rem 0.6rem; cursor: pointer; font-size: 1.15rem; line-height: 1; font-family: inherit; }
    @media (max-width: 720px) {
      .hamburger { display: block; }
      .navlinks { display: none; position: absolute; top: 100%; left: 0; right: 0; flex-direction: column; align-items: stretch; gap: 0; margin: 0; padding: 0.4rem; background: #141414; border-bottom: 1px solid #2a2a2a; box-shadow: 0 8px 20px rgba(0,0,0,0.4); }
      .navlinks.open { display: flex; }
      .navlinks .tab, .navlinks .refresh { width: 100%; text-align: left; border-bottom: 1px solid #1a1a1a; border-radius: 0; margin: 0; }
    }
  </style>
</head>
<body>
  <header class="topnav">
    <div class="brand">Free<span class="accent">Game</span>Store<span class="tag">Admin</span></div>
    <button class="hamburger" onclick="toggleNav()" aria-label="Menu" aria-expanded="false">&#9776;</button>
    <nav class="navlinks" id="navlinks">
      <button class="tab active" data-tab="overview" onclick="showTab('overview')">Overview</button>
      <button class="tab" data-tab="games" onclick="showTab('games')">Games</button>
      <button class="tab" data-tab="errors" onclick="showTab('errors')">Errors <span id="errBadge"></span></button>
      <button class="tab" data-tab="users" onclick="showTab('users')">Users</button>
      <button class="tab" data-tab="provision" onclick="showTab('provision')">Provision</button>
      <a class="tab" href="/docs" style="text-decoration:none;">API</a>
      <select class="sizesel" id="txtSize" onchange="setSize(this.value)" title="Text size" aria-label="Text size" style="margin-left:0.5rem;">
        <option value="sm">A·S</option>
        <option value="md">A·M</option>
        <option value="lg">A·L</option>
        <option value="xl">A·XL</option>
      </select>
      <button class="refresh" onclick="refreshActive()">Refresh</button>
    </nav>
  </header>

  <div class="meta" id="meta" style="margin-bottom:1rem;">Ready</div>

  <div id="tab-overview" class="tabpanel active">
    <div class="stats" id="ovStats"><span class="loading">Loading...</span></div>
    <h2>Errors (last 14 days)</h2>
    <div id="ovChart" style="display:flex;align-items:flex-end;gap:4px;height:140px;padding:1rem 0;"></div>
  </div>

  <div id="tab-games" class="tabpanel">
  <div class="stats" id="stats"></div>

  <!-- Filter bar -->
  <div style="margin-bottom:1rem;display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center;">
    <input id="search" type="text" placeholder="Search..." oninput="applyFilter()" style="padding:0.4rem 0.8rem;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:0.5rem;color:#e5e5e5;font-size:0.85rem;width:200px;" />
    <span style="color:#888;font-size:0.8rem;margin-left:0.5rem;">Filter:</span>
    <button class="filter-chip active" onclick="setFilter('all')">All</button>
    <button class="filter-chip" onclick="setFilter('healthy')">Healthy</button>
    <button class="filter-chip" onclick="setFilter('issues')">Issues</button>
    <span id="letterBar" style="margin-left:0.5rem;display:flex;gap:2px;flex-wrap:wrap;"></span>
  </div>

  <table><tr><th>Name</th><th>Status</th><th>Quality</th><th>Load</th><th>URL</th><th>Repo</th></tr><tbody id="dataTable"><tr><td colspan="6" class="loading">Loading...</td></tr></tbody></table>
  </div>

  <div id="tab-errors" class="tabpanel">
    <h2>Errors &amp; Crashes</h2>
    <p class="meta">Persisted from the create Pages Function and admin provisioning. Newest first.</p>
    <table><tr><th>When</th><th>Source</th><th>User</th><th>Message</th><th>Context</th></tr><tbody id="errTable"><tr><td colspan="5" class="loading">--</td></tr></tbody></table>
  </div>

  <div id="tab-users" class="tabpanel">
    <h2>Registered users <span id="userCount" class="gray"></span></h2>
    <p class="meta">Everyone who has signed in — including users who haven't published a game (so they don't appear under Creators below). To give someone a complimentary key: pick a funded provider + model in the <em>Complimentary access</em> form further down, then hit <strong>Grant</strong> on their row.</p>
    <table><tr><th>User</th><th>ID</th><th>Registered</th><th>Comp access</th><th></th></tr><tbody id="allUsersTable"><tr><td colspan="5" class="loading">--</td></tr></tbody></table>

    <h2 style="margin-top:2rem">Creators</h2>
    <p class="meta">Derived from the store registry (creatorGithub), most games first.</p>
    <table><tr><th>GitHub</th><th>Games</th><th>Game IDs</th></tr><tbody id="userTable"><tr><td colspan="3" class="loading">--</td></tr></tbody></table>

    <style>
    .compform{display:flex;flex-wrap:wrap;gap:0.5rem;margin:0.75rem 0;align-items:center}
    .compform input,.compform select{background:#1a1a1a;color:#e5e5e5;border:1px solid #2a2a2a;border-radius:0.35rem;padding:0.4rem 0.5rem;font-size:0.85rem}
    .compform button,#compTable button,.grant-btn,.revoke-btn{background:#1e3a5f;color:#93c5fd;border:1px solid #2a4a6f;border-radius:0.35rem;padding:0.4rem 0.75rem;cursor:pointer;font-size:0.85rem}
    #compTable button,.revoke-btn{background:#3a1e1e;color:#fca5a5;border-color:#5a2a2a}
    </style>
    <h2 style="margin-top:2rem">Complimentary access</h2>
    <p class="meta">Grant select users free builds on a platform-funded key. A grant only kicks in when the user has <em>no key of their own</em> (BYO always wins) and no game is charged to them. <span id="compFunded" class="gray"></span></p>
    <div class="compform">
      <input id="compLogin" placeholder="github-login" autocomplete="off" />
      <select id="compProvider" onchange="compModels()"></select>
      <select id="compModel"></select>
      <input id="compNote" placeholder="note (optional)" autocomplete="off" />
      <input id="compExpires" type="date" title="Expires (optional)" />
      <button onclick="grantComp()">Grant</button>
    </div>
    <div id="compMsg" class="meta"></div>
    <table><tr><th>User</th><th>Provider</th><th>Model</th><th>Note</th><th>By</th><th>Expires</th><th></th></tr><tbody id="compTable"><tr><td colspan="7" class="loading">--</td></tr></tbody></table>
  </div>

  <div id="tab-provision" class="tabpanel">
    <p class="meta">Manual provisioning — an admin escape hatch. Creators normally self-serve from the console; use this to repair a half-done provision or provision on someone's behalf.</p>
    <!--PROVISION-->
  </div>

  <script>
    var gameData=[];
    var qualityMap={};
    var liveStatus={};
    var currentFilter='all';
    var currentLetter='';

    function qualityClass(score){
      if(score>=95)return 'q-green';
      if(score>=80)return 'q-yellow';
      return 'q-red';
    }

    function row(d){
      var live=liveStatus[d.domain];
      var dot=live==='ok'?'<span class="green">LIVE</span>':live==='fail'?'<span class="red">DOWN</span>':live==='checking'?'<span class="yellow">...</span>':'<span class="gray">--</span>';
      var q=qualityMap[d.id];
      var scoreCell=q?'<span class="quality-score '+qualityClass(q.score)+'">'+q.score+'</span>':'<span class="q-gray">--</span>';
      var loadCell=q?q.loadTimeMs+'ms':'<span class="q-gray">--</span>';
      return '<tr data-name="'+d.name.toLowerCase()+'" data-live="'+(live==='ok'?'1':'0')+'"><td><strong>'+d.name+'</strong><br><small style="color:#888">'+d.id+'</small></td><td>'+dot+'</td><td>'+scoreCell+'</td><td>'+loadCell+'</td><td><a href="https://'+d.domain+'" target="_blank">'+d.domain+'</a></td><td><a href="https://github.com/'+d.org+'/'+d.id+'" target="_blank" style="font-size:0.8rem">'+d.org+'/'+d.id+'</a></td></tr>';
    }

    function setFilter(f){
      currentFilter=f;
      document.querySelectorAll('.filter-chip').forEach(function(c){c.classList.toggle('active',c.textContent.toLowerCase()===f)});
      renderTable();
    }
    function setLetter(l){
      currentLetter=currentLetter===l?'':l;
      document.querySelectorAll('.letter-btn').forEach(function(b){b.classList.toggle('active',b.textContent===currentLetter)});
      renderTable();
    }
    function buildLetterBar(){
      var letters=[...new Set(gameData.map(function(d){return d.name[0].toUpperCase()}))].sort();
      document.getElementById('letterBar').innerHTML=letters.map(function(l){return '<button class="letter-btn" onclick="setLetter(\\x27'+l+'\\x27)">'+l+'</button>'}).join('');
    }
    function applyFilter(){renderTable()}
    function renderTable(){
      var data=gameData;
      var search=document.getElementById('search').value.toLowerCase();
      var tbody=document.getElementById('dataTable');
      var filtered=data;
      if(search)filtered=filtered.filter(function(d){return d.name.toLowerCase().includes(search)||d.id.includes(search)});
      if(currentLetter)filtered=filtered.filter(function(d){return d.name[0].toUpperCase()===currentLetter});
      if(currentFilter==='healthy')filtered=filtered.filter(function(d){return liveStatus[d.domain]==='ok'});
      if(currentFilter==='issues')filtered=filtered.filter(function(d){return liveStatus[d.domain]==='fail'});
      tbody.innerHTML=filtered.length?filtered.map(row).join(''):'<tr><td colspan="6" style="color:#888">No results</td></tr>';
    }

    async function checkLive(domain){
      liveStatus[domain]='checking';
      try{
        await fetch('https://'+domain+'/',{mode:'no-cors',cache:'no-store'});
        liveStatus[domain]='ok';
      }catch(e){liveStatus[domain]='fail'}
    }

    async function loadAll(){
      document.getElementById('meta').textContent='Loading registry...';
      document.getElementById('dataTable').innerHTML='<tr><td colspan="6" class="loading">Loading...</td></tr>';
      var t0=Date.now();
      try{
        var [gamesRes,qualityRes]=await Promise.all([
          fetch('/api/status',{credentials:'include'}),
          fetch('/api/quality',{credentials:'include'})
        ]);
        if(!gamesRes.ok){document.getElementById('meta').textContent='API error';return}
        gameData=await gamesRes.json();
        qualityMap={};
        if(qualityRes.ok&&qualityRes.status!==204){
          var qd=await qualityRes.json();
          if(qd&&qd.games){qd.games.forEach(function(g){qualityMap[g.id]=g})}
        }
      }catch(e){document.getElementById('meta').textContent='Error: '+e;return}

      // Compute avg quality
      var qScores=gameData.map(function(d){return qualityMap[d.id]}).filter(Boolean);
      var avgQ=qScores.length?Math.round(qScores.reduce(function(s,g){return s+g.score},0)/qScores.length):0;
      var avgLabel=qScores.length?avgQ:'--';

      document.getElementById('stats').innerHTML='<div class="stat"><div class="num">'+gameData.length+'</div><div class="label">Total Games</div></div><div class="stat"><div class="num">--</div><div class="label">Live</div></div><div class="stat"><div class="num'+(qScores.length?' '+(avgQ>=95?'green':avgQ>=80?'yellow':'red'):'')+'">'+(qScores.length?avgQ:'--')+'</div><div class="label">Avg Quality</div></div>';
      document.getElementById('meta').textContent='Loaded in '+(Date.now()-t0)+'ms -- checking liveness...';
      buildLetterBar();renderTable();

      // Check liveness in parallel batches of 10
      for(var i=0;i<gameData.length;i+=10){
        var batch=gameData.slice(i,i+10);
        await Promise.all(batch.map(function(d){return checkLive(d.domain)}));
        renderTable();
      }
      var ok=gameData.filter(function(d){return liveStatus[d.domain]==='ok'}).length;
      document.getElementById('stats').innerHTML='<div class="stat"><div class="num">'+gameData.length+'</div><div class="label">Total Games</div></div><div class="stat"><div class="num green">'+ok+'</div><div class="label">Live</div></div><div class="stat"><div class="num red">'+(gameData.length-ok)+'</div><div class="label">Down</div></div><div class="stat"><div class="num'+(qScores.length?' '+(avgQ>=95?'green':avgQ>=80?'yellow':'red'):'')+'">'+(qScores.length?avgQ:'--')+'</div><div class="label">Avg Quality</div></div>';
      document.getElementById('meta').textContent='Done in '+(Date.now()-t0)+'ms';
    }

    // ---- tabs + Overview / Errors / Users ----
    var loaded={games:false,users:false};
    function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
    function stat(num,label,cls){return '<div class="stat"><div class="num'+(cls?' '+cls:'')+'">'+num+'</div><div class="label">'+label+'</div></div>'}
    function timeAgo(ts){try{var d=new Date(String(ts).replace(' ','T')+'Z');var s=(Date.now()-d.getTime())/1000;if(s<60)return Math.floor(s)+'s ago';if(s<3600)return Math.floor(s/60)+'m ago';if(s<86400)return Math.floor(s/3600)+'h ago';return Math.floor(s/86400)+'d ago';}catch(e){return ts}}
    function toggleNav(){var n=document.getElementById('navlinks');var open=n.classList.toggle('open');document.querySelector('.hamburger').setAttribute('aria-expanded',open?'true':'false');}
    function setSize(v){var px={sm:14,md:16,lg:18,xl:20}[v]||16;document.documentElement.style.fontSize=px+'px';try{localStorage.setItem('fgs_admin_textsize',v)}catch(e){}var s=document.getElementById('txtSize');if(s)s.value=v;}
    function showTab(name){
      document.querySelectorAll('.tab').forEach(function(t){t.classList.toggle('active',t.dataset&&t.dataset.tab===name)});
      document.querySelectorAll('.tabpanel').forEach(function(p){p.classList.toggle('active',p.id==='tab-'+name)});
      document.getElementById('navlinks').classList.remove('open'); // close mobile menu on select
      if(name==='games'&&!loaded.games){loaded.games=true;loadAll();}
      if(name==='errors')loadErrors();
      if(name==='users'&&!loaded.users){loaded.users=true;loadUsers();}
      if(name==='overview')loadOverview();
    }
    function refreshActive(){var a=document.querySelector('.tab.active');var n=a&&a.dataset?a.dataset.tab:'overview';if(n==='games')loadAll();else if(n==='errors')loadErrors();else if(n==='users')loadUsers();else loadOverview();}
    async function loadOverview(){
      try{
        var r=await fetch('/api/stats',{credentials:'include'});var s=await r.json();
        document.getElementById('ovStats').innerHTML=stat(s.games,'Games')+stat(s.creators,'Creators')+stat(s.errors24h,'Errors (24h)',s.errors24h>0?'red':'green')+stat(s.errorsTotal,'Errors (total)',s.errorsTotal>0?'yellow':'gray');
        var badge=document.getElementById('errBadge');badge.textContent=s.errors24h?'('+s.errors24h+')':'';badge.className=s.errors24h?'red':'';
        var series=s.errorSeries||[];var max=Math.max.apply(null,[1].concat(series.map(function(p){return p.c})));
        document.getElementById('ovChart').innerHTML=series.length?series.map(function(p){var h=Math.round(p.c/max*110);return '<div title="'+esc(p.d)+': '+p.c+'" style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%;"><div style="font-size:0.7rem;">'+p.c+'</div><div class="bar" style="height:'+h+'px;width:70%;background:'+(p.c>0?'#f87171':'#2a2a2a')+'"></div><div style="font-size:0.6rem;color:#888;margin-top:2px;">'+esc(p.d).slice(5)+'</div></div>'}).join(''):'<div class="gray">No errors logged yet.</div>';
      }catch(e){document.getElementById('ovStats').innerHTML='<div class="gray">stats error: '+esc(e)+'</div>'}
    }
    async function loadErrors(){
      var tb=document.getElementById('errTable');tb.innerHTML='<tr><td colspan="5" class="loading">Loading...</td></tr>';
      try{
        var r=await fetch('/api/errors?limit=200',{credentials:'include'});var rows=await r.json();
        tb.innerHTML=rows.length?rows.map(function(e){return '<tr><td style="white-space:nowrap">'+timeAgo(e.ts)+'<br><small class="gray">'+esc(e.ts)+' UTC</small></td><td><span class="src-tag">'+esc(e.source)+'</span></td><td>'+esc(e.user_github||'--')+'</td><td><strong class="red">'+esc(e.message)+'</strong>'+(e.stack?'<pre class="stack">'+esc(e.stack)+'</pre>':'')+'</td><td class="gray" style="font-size:0.75rem">'+esc(e.context||'')+'</td></tr>'}).join(''):'<tr><td colspan="5" class="green">No errors logged — clean.</td></tr>';
      }catch(e){tb.innerHTML='<tr><td colspan="5" class="red">Failed to load errors: '+esc(e)+'</td></tr>'}
    }
    async function loadUsers(){
      var tb=document.getElementById('userTable');tb.innerHTML='<tr><td colspan="3" class="loading">Loading...</td></tr>';
      try{
        var r=await fetch('/api/users',{credentials:'include'});var rows=await r.json();
        tb.innerHTML=rows.length?rows.map(function(u){return '<tr><td><a href="https://github.com/'+esc(u.login)+'" target="_blank">'+esc(u.login)+'</a></td><td><strong>'+u.games.length+'</strong></td><td class="gray" style="font-size:0.8rem">'+u.games.map(esc).join(', ')+'</td></tr>'}).join(''):'<tr><td colspan="3" class="gray">No creators yet.</td></tr>';
      }catch(e){tb.innerHTML='<tr><td colspan="3" class="red">Failed: '+esc(e)+'</td></tr>'}
      loadComp();loadAllUsers();
    }
    async function loadAllUsers(){
      var tb=document.getElementById('allUsersTable');
      try{
        var r=await fetch('/api/allusers',{credentials:'include'});var d=await r.json();
        var u=d.users||[];
        document.getElementById('userCount').textContent=u.length?('('+u.length+')'):'';
        tb.innerHTML=u.length?u.map(function(x){
          var comp=x.grant?('<span class="green">'+esc(x.grant.provider)+' / '+esc(x.grant.model)+'</span>'+(x.grant.expiresAt?' <span class="gray">(until '+esc((x.grant.expiresAt||'').slice(0,10))+')</span>':'')):'<span class="gray">--</span>';
          var action=x.grant?'<button class="revoke-btn" data-uid="'+esc(x.id)+'">Revoke</button>':'<button class="grant-btn" data-uid="'+esc(x.id)+'">Grant</button>';
          return '<tr><td>'+esc(x.name)+'</td><td class="gray" style="font-size:0.8rem">'+esc(x.id)+'</td><td class="gray" style="font-size:0.8rem">'+esc((x.createdAt||'').slice(0,10))+'</td><td>'+comp+'</td><td>'+action+'</td></tr>';
        }).join(''):'<tr><td colspan="5" class="gray">No registered users.</td></tr>';
      }catch(e){tb.innerHTML='<tr><td colspan="5" class="red">Failed: '+esc(e)+'</td></tr>'}
    }
    // Grant to a specific user id (from a Registered-users row), using whatever
    // provider+model is selected in the Complimentary access form.
    async function grantUser(uid){
      var provider=document.getElementById('compProvider').value;
      var model=document.getElementById('compModel').value;
      var msg=document.getElementById('compMsg');
      if(!model){msg.innerHTML='<span class="red">Pick a funded provider + model in the form below first.</span>';return;}
      msg.textContent='Granting '+provider+' / '+model+' to '+uid+'...';
      try{
        var r=await fetch('/api/comp',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:uid,provider:provider,model:model})});
        var d=await r.json().catch(function(){return{}});
        if(!r.ok){msg.innerHTML='<span class="red">'+esc(d.error||('Failed ('+r.status+')'))+'</span>';return;}
        msg.innerHTML='<span class="green">Granted '+esc(provider)+' / '+esc(model)+' to '+esc(uid)+'.</span>';
        loadComp();loadAllUsers();
      }catch(e){msg.innerHTML='<span class="red">'+esc(e)+'</span>'}
    }
    // Complimentary access — mirrors the studio model catalog so grants use valid ids.
    var COMP_MODELS={anthropic:[['claude-sonnet-4-6','Claude Sonnet 4.6'],['claude-opus-4-6','Claude Opus 4.6'],['claude-haiku-4-5-20251001','Claude Haiku 4.5']],openai:[['gpt-4o','GPT-4o'],['gpt-4o-mini','GPT-4o Mini'],['o3','o3'],['o4-mini','o4 Mini']],google:[['gemini-2.5-pro','Gemini 2.5 Pro'],['gemini-2.5-flash','Gemini 2.5 Flash']],github:[['openai/gpt-4.1','GPT-4.1'],['openai/gpt-4o','GPT-4o']]};
    var COMP_PROVIDERS=['anthropic','openai','google','github'];
    function compInitProviders(funded){
      var sel=document.getElementById('compProvider');
      sel.innerHTML=COMP_PROVIDERS.map(function(p){var ok=funded.indexOf(p)>=0;return '<option value="'+p+'"'+(ok?'':' disabled')+'>'+p+(ok?'':' (no key)')+'</option>'}).join('');
      var first=COMP_PROVIDERS.filter(function(p){return funded.indexOf(p)>=0})[0]||COMP_PROVIDERS[0];
      sel.value=first;compModels();
    }
    function compModels(){
      var p=document.getElementById('compProvider').value;var m=document.getElementById('compModel');
      var opts=COMP_MODELS[p]||[];m.innerHTML=opts.map(function(o){return '<option value="'+esc(o[0])+'">'+esc(o[1])+'</option>'}).join('');
    }
    async function grantComp(){
      var login=document.getElementById('compLogin').value.trim();
      var provider=document.getElementById('compProvider').value;
      var model=document.getElementById('compModel').value;
      var note=document.getElementById('compNote').value.trim();
      var exp=document.getElementById('compExpires').value;
      var msg=document.getElementById('compMsg');
      if(!login){msg.innerHTML='<span class="red">Enter a GitHub login.</span>';return;}
      if(!model){msg.innerHTML='<span class="red">Pick a funded provider + model first.</span>';return;}
      msg.textContent='Granting...';
      var body={login:login,provider:provider,model:model};
      if(note)body.note=note;
      if(exp)body.expiresAt=new Date(exp+'T23:59:59Z').toISOString();
      try{
        var r=await fetch('/api/comp',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
        var d=await r.json().catch(function(){return{}});
        if(!r.ok){msg.innerHTML='<span class="red">'+esc(d.error||('Failed ('+r.status+')'))+'</span>';return;}
        msg.innerHTML='<span class="green">Granted '+esc(provider)+' / '+esc(model)+' to '+esc(login)+'.</span>';
        document.getElementById('compLogin').value='';document.getElementById('compNote').value='';document.getElementById('compExpires').value='';
        loadComp();
      }catch(e){msg.innerHTML='<span class="red">'+esc(e)+'</span>'}
    }
    async function revokeComp(userId){
      if(!confirm('Revoke complimentary access for '+userId+'?'))return;
      try{
        var r=await fetch('/api/comp/'+encodeURIComponent(userId),{method:'DELETE',credentials:'include'});
        if(!r.ok){var d=await r.json().catch(function(){return{}});alert('Revoke failed: '+(d.error||r.status));return;}
        loadComp();loadAllUsers();
      }catch(e){alert('Revoke failed: '+e)}
    }
    async function loadComp(){
      var tb=document.getElementById('compTable');
      try{
        var r=await fetch('/api/comp',{credentials:'include'});var d=await r.json();
        var funded=d.funded||[];compInitProviders(funded);
        document.getElementById('compFunded').textContent=funded.length?('Funded: '+funded.join(', ')+'.'):'No platform keys set yet — add a COMP_KEY_<PROVIDER> secret to fund one.';
        var g=d.grants||[];
        tb.innerHTML=g.length?g.map(function(x){return '<tr><td>'+esc(x.userId)+'</td><td>'+esc(x.provider)+'</td><td>'+esc(x.model)+'</td><td class="gray">'+esc(x.note||'')+'</td><td class="gray">'+esc(x.grantedBy||'')+'</td><td class="gray">'+esc(x.expiresAt||'never')+'</td><td><button class="revoke-btn" data-uid="'+esc(x.userId)+'">Revoke</button></td></tr>'}).join(''):'<tr><td colspan="7" class="gray">No complimentary grants.</td></tr>';
      }catch(e){tb.innerHTML='<tr><td colspan="7" class="red">Failed: '+esc(e)+'</td></tr>'}
    }
    // Delegated grant/revoke handlers — data-uid attributes avoid quoting a value
    // into an inline onclick, which inside this template-literal-in-a-string
    // mis-escapes (\\' collapses to ') and would break the entire console script.
    document.addEventListener('click',function(ev){
      var t=ev.target;if(!t||!t.closest)return;
      var rb=t.closest('.revoke-btn');if(rb){revokeComp(rb.getAttribute('data-uid'));return;}
      var gb=t.closest('.grant-btn');if(gb){grantUser(gb.getAttribute('data-uid'));return;}
    });
    setSize((function(){try{return localStorage.getItem('fgs_admin_textsize')}catch(e){return null}})()||'md');
    showTab('overview');
  </script>
</body>
</html>`;
}

function renderApiDocs(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>API Docs -- FreeGameStore Admin</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0f0f0f;color:#e5e5e5;padding:2rem;max-width:800px;margin:0 auto;line-height:1.6}
    h1{font-size:1.5rem;margin-bottom:0.5rem}
    h2{font-size:1.2rem;margin:2.5rem 0 0.75rem;color:#34d399}
    h3{font-size:1rem;margin:1.5rem 0 0.5rem}
    p{margin-bottom:0.75rem;color:#ccc}
    code{background:#1a1a1a;padding:0.15rem 0.4rem;border-radius:0.25rem;font-size:0.85rem}
    pre{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:0.75rem;padding:1rem;margin:0.75rem 0;overflow-x:auto;font-size:0.85rem;line-height:1.5}
    .method{display:inline-block;padding:0.2rem 0.5rem;border-radius:0.25rem;font-weight:700;font-size:0.75rem;margin-right:0.5rem}
    .get{background:#1a4731;color:#34d399}
    .post{background:#1e3a5f;color:#60a5fa}
    a{color:#34d399}
    .badge{display:inline-block;padding:0.15rem 0.5rem;border-radius:1rem;font-size:0.7rem;font-weight:600}
    .auth{background:#2d1f0f;color:#fbbf24}
    hr{border:none;border-top:1px solid #2a2a2a;margin:2rem 0}
  </style>
</head>
<body>
  <h1>FreeGameStore Admin API</h1>
  <p>Base URL: <code>https://admin.freegamestore.online</code></p>
  <p>The console and every read/observability endpoint are restricted to <span class="badge auth">admin</span> — a signed-in, allowlisted Google email. The creator-facing publish endpoints use their own per-caller auth (see below). No Cloudflare Access is involved.</p>

  <hr>

  <h2>Authentication</h2>
  <h3>Admin console + read endpoints (Google sign-in)</h3>
  <p>Visit <a href="https://admin.freegamestore.online">admin.freegamestore.online</a> and sign in with Google. Only emails in the <code>ADMIN_EMAILS</code> allowlist can access; everyone else gets a sign-in / not-authorized page. Identity is a verified Google email resolved via the auth worker's <code>/me</code>; the browser carries the <code>fgs_token</code> cookie (set on <code>.freegamestore.online</code>).</p>
  <p>Gated: <code>/</code>, <code>/docs</code>, <code>/api/status*</code>, <code>/api/quality</code>, <code>/api/errors</code>, <code>/api/stats</code>, <code>/api/users</code>, <code>/api/reconcile</code>.</p>

  <h3>Publish endpoints (creators + the VibeCode agent)</h3>
  <p><code>/api/provision</code>, <code>/api/publish</code>, and <code>PATCH/DELETE /api/games/:id</code> are NOT admin-gated — creators self-serve. They accept a signed-in creator's <code>fgs_token</code> (cookie or <code>X-FGS-Token</code>), or, for worker-to-worker calls (the agent's VibeCode deploy, which has no user token), a shared <code>X-Internal-Token</code>. On the internal path the owner is taken from the request body's <code>creatorGithub</code>.</p>

  <hr>

  <h2>Endpoints</h2>

  <h3><span class="method get">GET</span> /api/status</h3>
  <p>Returns registry data for all games.</p>
  <pre>GET /api/status

Response: [
  {
    "id": "chess",
    "name": "Chess",
    "org": "freegamestore-online",
    "cfProject": "freechessapp",
    "domain": "chess.freegamestore.online"
  }
]</pre>
  <p>Add <code>?detail=true</code> for full deploy status (slower -- makes a status call per game).</p>

  <h3><span class="method get">GET</span> /api/status/game</h3>
  <p>Returns deploy status for a single game.</p>
  <pre>GET /api/status/game?id=chess</pre>

  <h3><span class="method get">GET</span> /api/quality</h3>
  <p>Returns quality audit results for all games (proxied from GitHub).</p>
  <pre>GET /api/quality

Response: {
  "timestamp": "2026-05-08T...",
  "games": [
    { "id": "chess", "score": 88, "loadTimeMs": 1200, "consoleErrors": [] }
  ]
}</pre>
  <p>Returns <code>204 No Content</code> if the auditor has not produced results yet.</p>

  <h3><span class="method post">POST</span> /api/provision</h3>
  <p>Provisions a new game (Path B — no CF Pages). Creates a GitHub repo from <code>template-game-canvas</code>, adds the creator as a collaborator, writes a host route to D1, and adds the store registry entry. The <code>fgs/host</code> worker then serves the built game from the <code>fgs-games</code> R2 bucket at <code>&lt;id&gt;.freegamestore.online</code> — there is no per-game CF Pages project, DNS record, or <code>.pages.dev</code>.</p>

  <pre>POST /api/provision
Content-Type: application/json

{
  "id": "chess",
  "name": "Chess",
  "category": "strategy",
  "icon": "&amp;#9812;",
  "iconBg": "#ecfdf5",
  "description": "Classic chess game",
  "creatorGithub": "octocat"
}

Response: {
  "steps": [
    { "name": "GitHub repo", "status": "ok", "detail": "Created freegamestore-online/chess from template-game-canvas" },
    { "name": "Collaborator", "status": "ok", "detail": "Invited octocat" },
    { "name": "Host route", "status": "ok", "detail": "chess -> r2 (fgs-games/games/chess)" },
    { "name": "Store registry", "status": "ok", "detail": "Added Chess" }
  ],
  "success": true
}</pre>
  <p>Step statuses: <code>ok</code> (created), <code>skip</code> (already exists), <code>fail</code> (error -- check detail). Idempotent: re-provisioning an existing id skips rather than fails.</p>

  <hr>

  <h2>Workflow</h2>
  <pre>
1. POST /api/provision  ->  repo + collaborator + host route + registry
2. Push code to main    ->  GitHub Actions builds web/ and uploads to R2
3. Host serves it        ->  https://&lt;id&gt;.freegamestore.online (from R2)
4. GET /api/status      ->  verify the game is registered + routed</pre>
  <p>Creators normally never call this directly — they use the console (VibeCode / create form) or the <code>fgs</code> CLI, which funnel through here.</p>

  <p style="margin-top:1rem"><a href="/">&larr; Back to Dashboard</a></p>
</body>
</html>`;
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
  /** Populated only on the scheduled (heal=true) path: what was actually fixed. */
  healed?: { insertedRoutes: string[]; deletedRoutes: string[] };
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

  const report: ReconcileReport = {
    ts,
    registryCount: registryIds.size,
    routeCount: routeSlugs.size,
    missingRoute,
    orphanRoute,
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
      "/", "/docs", "/api/reconcile", "/api/status", "/api/status/game",
      "/api/quality", "/api/errors", "/api/stats", "/api/users",
    ]);
    if (ADMIN_PATHS.has(url.pathname)) {
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
      return jsonResponse(await listErrors(env.DB, limit), 200, request);
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
    if (url.pathname === "/api/comp" || url.pathname.startsWith("/api/comp/") || url.pathname === "/api/allusers") {
      const { email, isAdmin } = await authenticateAdmin(request, env);
      if (!isAdmin) return jsonResponse({ error: "unauthorized" }, 401, request);
      if (!env.AGENT || !env.INTERNAL_TOKEN) {
        return jsonResponse({ error: "complimentary grants not wired (missing AGENT binding or INTERNAL_TOKEN)" }, 500, request);
      }
      // /api/allusers → the agent's registered-users listing; /api/comp* → grants.
      const agentPath = url.pathname === "/api/allusers"
        ? "/v1/admin/users"
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
      if (!login) {
        return jsonResponse({ error: "unauthorized" }, 401, request);
      }
      try {
        const result = await handleDeleteGame(gameMatch[1]!, login, env as any);
        return jsonResponse(result, result.error ? 400 : 200, request);
      } catch (e) {
        await recordError(env.DB, { source: "admin/games.delete", user: login, context: `id=${gameMatch[1]}`, message: (e as Error)?.message ?? String(e), stack: (e as Error)?.stack });
        return jsonResponse({ error: String(e) }, 500, request);
      }
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

    // Render dashboard; the manual provision form lives in its own Provision tab
    // now (not appended to every page) — creators normally self-serve via the
    // console, so it's an admin escape hatch rather than the primary path.
    let html = renderDashboardShell();
    html = html.replace("<!--PROVISION-->", renderProvisionForm());
    return new Response(html, { headers: { "Content-Type": "text/html", "Cache-Control": "no-store" } });
  },
};
