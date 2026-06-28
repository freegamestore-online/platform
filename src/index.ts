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
const CALLBACK_PATH = "/callback";

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
  if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

// --- CORS ---

function cors(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  const allowed = ALLOWED_ORIGIN.test(origin) || origin === "https://freegamestore.online" || origin === "http://localhost:5173";
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
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

// --- Route handlers ---

function getRedirectUri(request: Request): string {
  const url = new URL(request.url);
  return `${url.origin}${CALLBACK_PATH}`;
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const redirect = url.searchParams.get("redirect") ?? "https://freegamestore.online";

  const state = base64urlEncode(JSON.stringify({ redirect }));

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: getRedirectUri(request),
    response_type: "code",
    scope: "openid profile",
    state,
    prompt: "select_account",
  });

  return new Response(null, {
    status: 302,
    headers: { Location: `${GOOGLE_AUTH_URL}?${params}` },
  });
}

async function handleCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");

  if (!code || !stateParam) {
    return new Response("Missing code or state", { status: 400 });
  }

  // Parse state to get redirect URL
  let redirect = "https://freegamestore.online";
  try {
    const state = JSON.parse(base64urlDecode(stateParam)) as { redirect?: string };
    if (state.redirect) redirect = state.redirect;
  } catch {
    // fall through with default redirect
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

  const user = (await userRes.json()) as { sub: string; name: string; picture?: string };

  // Upsert user in D1
  await env.DB.prepare(
    `INSERT INTO users (id, name, avatar_url) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, avatar_url = excluded.avatar_url, last_seen = datetime('now')`,
  )
    .bind(user.sub, user.name, user.picture ?? null)
    .run();

  // Create JWT
  const now = Math.floor(Date.now() / 1000);
  const token = await jwtSign(
    {
      sub: user.sub,
      name: user.name,
      avatar: user.picture ?? null,
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
  const token = getCookie(request, COOKIE_NAME);
  if (!token) {
    return json({ error: "Not signed in" }, 401, request);
  }

  const payload = await jwtVerify(token, env.JWT_SECRET);
  if (!payload) {
    return json({ error: "Invalid or expired token" }, 401, request);
  }

  return json(
    { id: payload.sub, name: payload.name, avatar: payload.avatar },
    200,
    request,
  );
}

function handleLogout(request: Request): Response {
  const referrer = request.headers.get("Referer") ?? "https://freegamestore.online";
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
  const redirect = url.searchParams.get("redirect") ?? "https://freegamestore.online";
  const state = base64urlEncode(JSON.stringify({ redirect }));

  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: `${url.origin}/callback/github`,
    scope: "read:user",
    state,
  });

  return new Response(null, {
    status: 302,
    headers: { Location: `${GITHUB_AUTH_URL}?${params}` },
  });
}

async function handleGitHubCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");

  if (!code || !stateParam) {
    return new Response("Missing code or state", { status: 400 });
  }

  let redirect = "https://freegamestore.online";
  try {
    const state = JSON.parse(base64urlDecode(stateParam)) as { redirect?: string };
    if (state.redirect) redirect = state.redirect;
  } catch { /* fall through */ }

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

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(request) });
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

    return json({ error: "Not found" }, 404, request);
  },
};
