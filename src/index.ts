import { vaultList, vaultSet, vaultGet, vaultDelete } from "./vault";

interface Env {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  JWT_SECRET: string;
}

const ALLOWED_ORIGIN = /^https:\/\/[\w-]+\.freegamestore\.online$/;
const COOKIE_NAME = "fgs_token";
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
const GITHUB_AUTH_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const CALLBACK_PATH = "/callback"; // Google OAuth callback route (see fetch router)

// --- JWT utilities (HMAC-SHA256, no dependencies) ---

function base64url(data: Uint8Array): string {
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlEncode(str: string): string {
  return base64url(new TextEncoder().encode(str));
}

function base64urlDecode(str: string): string {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function getSigningKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function jwtSign(payload: Record<string, unknown>, secret: string): Promise<string> {
  const header = base64urlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64urlEncode(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const key = await getSigningKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return `${data}.${base64url(new Uint8Array(sig))}`;
}

async function jwtVerify(token: string, secret: string): Promise<Record<string, unknown> | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const key = await getSigningKey(secret);
  const sigBytes = Uint8Array.from(atob(sig.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const valid = await crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(`${header}.${body}`));
  if (!valid) return null;
  const payload = JSON.parse(base64urlDecode(body)) as Record<string, unknown>;
  // Require a numeric, unexpired exp. A token missing exp (or with a non-numeric
  // one) must not be treated as non-expiring.
  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

// --- CORS ---

// First-party origins — the only ones trusted with credentialed access to
// SENSITIVE endpoints (the AI-key vault). Game subdomains
// (<game>.freegamestore.online) serve untrusted user content and are
// deliberately excluded: without this, any published game could fetch
// /vault/get with the player's session cookie and exfiltrate their decrypted
// BYO API keys.
const FIRST_PARTY_ORIGINS = new Set([
  "https://freegamestore.online",
  "https://console.freegamestore.online",
  "http://localhost:5173",
]);

export function isFirstParty(origin: string): boolean {
  return FIRST_PARTY_ORIGINS.has(origin);
}

// Broad CORS for identity endpoints (/me, OAuth) that games legitimately need
// for the GameAuth component. Reflects any *.freegamestore.online; safe because
// these endpoints expose only the player's own public identity, never secrets.
function cors(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  const allowed = ALLOWED_ORIGIN.test(origin) || origin === "https://freegamestore.online" || origin === "http://localhost:5173";
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

// Strict CORS for the vault — first-party origins only, never game subdomains.
export function corsVault(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": isFirstParty(origin) ? origin : "",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(data: unknown, status: number, request: Request): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors(request) },
  });
}

// --- Cookie helpers ---

function setTokenCookie(token: string): string {
  return `${COOKIE_NAME}=${token}; Domain=.freegamestore.online; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`;
}

function clearTokenCookie(): string {
  return `${COOKIE_NAME}=; Domain=.freegamestore.online; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie") ?? "";
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? match[1] : null;
}

// --- OAuth state / redirect safety ---

const OAUTH_STATE_COOKIE = "fgs_oauth_state";

/** SECURITY: allowlist the post-login redirect to our own origins. An
 *  attacker-controlled `redirect` param would otherwise be reflected into the
 *  Location header (open redirect / phishing). */
function safeRedirect(raw: string | null | undefined): string {
  const fallback = "https://freegamestore.online";
  if (!raw) return fallback;
  try {
    const u = new URL(raw);
    const h = u.hostname;
    if (u.protocol === "https:" && (h === "freegamestore.online" || h.endsWith(".freegamestore.online"))) {
      return u.toString();
    }
    if ((u.protocol === "http:" || u.protocol === "https:") && (h === "localhost" || h === "127.0.0.1")) {
      return u.toString();
    }
  } catch {
    /* not a valid absolute URL */
  }
  return fallback;
}

/** Short-lived, browser-bound nonce cookie for OAuth CSRF protection. */
function setStateCookie(nonce: string): string {
  return `${OAUTH_STATE_COOKIE}=${nonce}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
}

// --- Route handlers ---

function getRedirectUri(request: Request): string {
  const url = new URL(request.url);
  return `${url.origin}${CALLBACK_PATH}`;
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const redirect = safeRedirect(url.searchParams.get("redirect"));
  const nonce = crypto.randomUUID();
  const state = base64urlEncode(JSON.stringify({ redirect, nonce }));

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: getRedirectUri(request),
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });

  return new Response(null, {
    status: 302,
    headers: { Location: `${GOOGLE_AUTH_URL}?${params}`, "Set-Cookie": setStateCookie(nonce) },
  });
}

async function handleCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");

  if (!code || !stateParam) {
    return new Response("Missing code or state", { status: 400 });
  }

  // SECURITY: validate the CSRF nonce (state must match the cookie set at /login)
  // and allowlist the redirect. Prevents login-CSRF / session fixation + open redirect.
  const cookieNonce = getCookie(request, OAUTH_STATE_COOKIE);
  let redirect = "https://freegamestore.online";
  let stateNonce: string | undefined;
  try {
    const state = JSON.parse(base64urlDecode(stateParam)) as { redirect?: string; nonce?: string };
    redirect = safeRedirect(state.redirect);
    stateNonce = state.nonce;
  } catch {
    // fall through with default redirect
  }
  if (!cookieNonce || !stateNonce || cookieNonce !== stateNonce) {
    return new Response("Invalid OAuth state", { status: 403 });
  }

  // Exchange code for tokens
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: getRedirectUri(request),
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    return new Response("Token exchange failed", { status: 502 });
  }

  const tokens = (await tokenRes.json()) as { access_token: string };

  // Fetch user info
  const userRes = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userRes.ok) {
    return new Response("Failed to fetch user info", { status: 502 });
  }

  const user = (await userRes.json()) as { sub: string; name: string; picture?: string; email?: string; email_verified?: boolean };

  // Only trust a Google-verified email — it's what admin access is gated on, so
  // an unverified value must never make it into the token.
  const email = user.email_verified && user.email ? user.email.toLowerCase() : null;

  // Upsert user in D1
  await env.DB.prepare(
    `INSERT INTO users (id, name, avatar_url) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, avatar_url = excluded.avatar_url, last_seen = datetime('now')`,
  )
    .bind(user.sub, user.name, user.picture ?? null)
    .run();

  // Create JWT. `email` is carried as a claim (verified only) so downstream
  // workers can gate on it — /me exposes it solely over the worker-to-worker
  // path, never to games (see handleMe).
  const now = Math.floor(Date.now() / 1000);
  const token = await jwtSign(
    {
      sub: user.sub,
      name: user.name,
      avatar: user.picture ?? null,
      email,
      iat: now,
      exp: now + COOKIE_MAX_AGE,
    },
    env.JWT_SECRET,
  );

  return new Response(null, {
    status: 302,
    headers: {
      Location: redirect,
      "Set-Cookie": setTokenCookie(token),
    },
  });
}

async function handleMe(request: Request, env: Env): Promise<Response> {
  // Accept the token from the cookie (browser) OR an Authorization Bearer
  // (worker-to-worker, e.g. agent/admin verifying an fgs_token — Workers can't
  // reliably set the Cookie header on a subrequest).
  // X-FGS-Token (worker-to-worker — Cloudflare strips Authorization/Cookie on
  // those hops), then Authorization Bearer, then the browser cookie.
  const authz = request.headers.get("Authorization") ?? "";
  const token = request.headers.get("X-FGS-Token") || (authz.startsWith("Bearer ") ? authz.slice(7).trim() : "") || getCookie(request, COOKIE_NAME);
  if (!token) {
    return json({ error: "Not signed in" }, 401, request);
  }

  const payload = await jwtVerify(token, env.JWT_SECRET);
  if (!payload) {
    return json({ error: "Invalid or expired token" }, 401, request);
  }

  // Email is PII, so expose it only on the worker-to-worker path (X-FGS-Token —
  // e.g. the admin worker resolving the signed-in user for its allowlist), never
  // to a game subdomain calling /me with the browser cookie over broad CORS.
  const includeEmail = !!request.headers.get("X-FGS-Token");

  return json(
    // `login` is the GitHub username (distinct from `id`/`sub` = "github:<id>").
    // Consumers that provision GitHub resources for the signed-in creator (e.g.
    // the agent adding them as a repo collaborator) need the login, not the sub.
    {
      id: payload.sub,
      name: payload.name,
      avatar: payload.avatar,
      login: payload.login ?? null,
      ...(includeEmail ? { email: payload.email ?? null } : {}),
    },
    200,
    request,
  );
}

// --- AI key vault (requires a valid session) ---

async function handleVault(request: Request, env: Env, path: string): Promise<Response> {
  // Strict CORS — the vault returns decrypted API keys, so responses carry an
  // Access-Control-Allow-Origin only for first-party origins. A game subdomain
  // gets an empty ACAO and the browser blocks the read.
  const vjson = (data: unknown, status: number) =>
    new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...corsVault(request) } });

  // Defense in depth: refuse outright if a cross-origin caller presents a
  // non-first-party Origin (e.g. <game>.freegamestore.online). Same-origin /
  // server-to-server callers send no Origin and still require a valid session.
  const origin = request.headers.get("Origin");
  if (origin && !isFirstParty(origin)) return vjson({ error: "forbidden" }, 403);

  const token = getCookie(request, COOKIE_NAME);
  const payload = token ? await jwtVerify(token, env.JWT_SECRET) : null;
  if (!payload?.sub) return vjson({ error: "Not signed in" }, 401);
  const userId = payload.sub as string;

  if (request.method === "GET" && path === "/vault") {
    return vjson({ providers: await vaultList(env.DB, userId) }, 200);
  }

  if (request.method === "POST" && path === "/vault/set") {
    const body = (await request.json().catch(() => ({}))) as { provider?: string; key?: string };
    if (!body.provider || !body.key) return vjson({ error: "provider and key required" }, 400);
    await vaultSet(env.DB, env.JWT_SECRET, userId, body.provider, body.key);
    return vjson({ ok: true }, 200);
  }

  if (request.method === "POST" && path === "/vault/get") {
    const body = (await request.json().catch(() => ({}))) as { provider?: string };
    if (!body.provider) return vjson({ error: "provider required" }, 400);
    return vjson({ key: await vaultGet(env.DB, env.JWT_SECRET, userId, body.provider) }, 200);
  }

  if (request.method === "POST" && path === "/vault/delete") {
    const body = (await request.json().catch(() => ({}))) as { provider?: string };
    if (!body.provider) return vjson({ error: "provider required" }, 400);
    await vaultDelete(env.DB, userId, body.provider);
    return vjson({ ok: true }, 200);
  }

  return vjson({ error: "Not found" }, 404);
}

function handleLogout(request: Request): Response {
  const referrer = safeRedirect(request.headers.get("Referer"));
  return new Response(null, {
    status: 302,
    headers: {
      Location: referrer,
      "Set-Cookie": clearTokenCookie(),
    },
  });
}

// --- GitHub OAuth handlers ---

async function handleGitHubLogin(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const redirect = safeRedirect(url.searchParams.get("redirect"));
  const nonce = crypto.randomUUID();
  const state = base64urlEncode(JSON.stringify({ redirect, nonce }));

  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: `${url.origin}/callback/github`,
    scope: "read:user",
    state,
  });

  return new Response(null, {
    status: 302,
    headers: { Location: `${GITHUB_AUTH_URL}?${params}`, "Set-Cookie": setStateCookie(nonce) },
  });
}

async function handleGitHubCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");

  if (!code || !stateParam) {
    return new Response("Missing code or state", { status: 400 });
  }

  // SECURITY: validate the CSRF nonce + allowlist the redirect (see Google callback).
  const cookieNonce = getCookie(request, OAUTH_STATE_COOKIE);
  let redirect = "https://freegamestore.online";
  let stateNonce: string | undefined;
  try {
    const state = JSON.parse(base64urlDecode(stateParam)) as { redirect?: string; nonce?: string };
    redirect = safeRedirect(state.redirect);
    stateNonce = state.nonce;
  } catch { /* fall through */ }
  if (!cookieNonce || !stateNonce || cookieNonce !== stateNonce) {
    return new Response("Invalid OAuth state", { status: 403 });
  }

  // Exchange code for access token
  const tokenRes = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });

  if (!tokenRes.ok) {
    return new Response("Token exchange failed", { status: 502 });
  }

  const tokens = (await tokenRes.json()) as { access_token: string };

  // Fetch GitHub user
  const userRes = await fetch(GITHUB_USER_URL, {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      "User-Agent": "freegamestore-auth",
    },
  });

  if (!userRes.ok) {
    return new Response("Failed to fetch user info", { status: 502 });
  }

  const ghUser = (await userRes.json()) as { id: number; login: string; avatar_url: string; name?: string };

  // Upsert user — use github:<id> as the user ID to avoid collisions with Google users
  const userId = `github:${ghUser.id}`;
  const displayName = ghUser.name ?? ghUser.login;
  await env.DB.prepare(
    `INSERT INTO users (id, name, avatar_url) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, avatar_url = excluded.avatar_url, last_seen = datetime('now')`,
  )
    .bind(userId, displayName, ghUser.avatar_url)
    .run();

  // Create JWT
  const now = Math.floor(Date.now() / 1000);
  const token = await jwtSign(
    {
      sub: userId,
      name: displayName,
      login: ghUser.login,
      avatar: ghUser.avatar_url,
      iat: now,
      exp: now + COOKIE_MAX_AGE,
    },
    env.JWT_SECRET,
  );

  return new Response(null, {
    status: 302,
    headers: {
      Location: redirect,
      "Set-Cookie": setTokenCookie(token),
    },
  });
}

// --- Main ---

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // Versioned alias: /v1/me, /v1/logout, etc. resolve to the same handlers
    // as their unversioned paths so older game bundles keep working while new
    // ones can adopt /v1. OAuth redirect URIs are always unversioned. See
    // platform/docs/API-CONTRACT.md (additive-only contract).
    const path = url.pathname.startsWith("/v1/") ? url.pathname.slice(3) : url.pathname;

    // CORS preflight — vault preflights use the strict first-party allowlist so
    // a game origin's preflight fails and the browser never sends the request.
    if (request.method === "OPTIONS") {
      const headers = path === "/vault" || path.startsWith("/vault/") ? corsVault(request) : cors(request);
      return new Response(null, { status: 204, headers });
    }

    // GitHub OAuth (primary — used by console + CLI)
    if (request.method === "GET" && path === "/login") {
      return handleGitHubLogin(request, env);
    }
    if (request.method === "GET" && path === "/callback/github") {
      return handleGitHubCallback(request, env);
    }

    // Google OAuth (legacy — used by games for player auth)
    if (request.method === "GET" && path === "/login/google") {
      return handleLogin(request, env);
    }
    if (request.method === "GET" && path === "/callback") {
      return handleCallback(request, env);
    }

    // GET /me
    if (request.method === "GET" && path === "/me") {
      return handleMe(request, env);
    }

    // POST /logout
    if (request.method === "POST" && path === "/logout") {
      return handleLogout(request);
    }

    // AI key vault — /vault, /vault/set, /vault/get, /vault/delete
    if (path === "/vault" || path.startsWith("/vault/")) {
      return handleVault(request, env, path);
    }

    return json({ error: "Not found" }, 404, request);
  },
};
