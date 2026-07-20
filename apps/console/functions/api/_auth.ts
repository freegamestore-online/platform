// Shared auth + CORS for publisher API functions.
//
// Accepts either the publisher's own session (fgs_pub_session -> KV) OR the
// creator console's auth JWT (fgs_token), so the console can call /api/create
// and /api/publish directly without a second sign-in. The fgs_token is a
// GitHub-OAuth JWT minted by the auth worker; its `login` claim is the GitHub
// username, which is exactly the creator identity these endpoints need.
//
// Requires JWT_SECRET (same value as the auth worker) to verify console tokens.
// Files prefixed with `_` are not routed by Pages, so this is import-only.

export interface SessionEnv {
  SESSIONS: KVNamespace;
  JWT_SECRET?: string;
}

// First-party origins ONLY. The old `*.freegamestore.online` wildcard reflected
// game subdomains too — and games are untrusted user content sharing the
// session cookie's registrable domain, so any game could read this credentialed
// API (project list, chat history, /api/me) cross-origin. Pin to the console +
// storefront + dev origins.
const FIRST_PARTY_ORIGINS = new Set([
  "https://console.freegamestore.online",
  "https://freegamestore.online",
  "http://localhost:5173",
]);

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  const allow = FIRST_PARTY_ORIGINS.has(origin) ? origin : "https://console.freegamestore.online";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}

function getCookie(request: Request, name: string): string | null {
  const c = request.headers.get("Cookie");
  if (!c) return null;
  const m = c.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : null;
}

function b64urlToBytes(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

export async function verifyJWT(token: string, secret: string): Promise<Record<string, unknown> | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
    if (header.alg !== "HS256") return null;
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("HMAC", key, b64urlToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1]))) as Record<string, unknown>;
    // Require a numeric, unexpired exp — a token missing exp must not verify forever.
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/** The signed-in creator's identity, normalized across both session sources. */
export interface CreatorUser {
  /** GitHub login / username. */
  github: string;
  /** Numeric GitHub user id — the canonical UID. */
  githubId: number | null;
  /** Stable subject identifier, e.g. "github:2824906". */
  sub: string | null;
  name: string | null;
  avatarUrl: string;
  email: string | null;
}

/**
 * Resolve the signed-in creator from either the legacy publisher KV session
 * (`fgs_pub_session`) or — the canonical path since auth consolidation — the
 * `fgs_token` JWT minted by the freegamestore-auth worker. The auth worker is
 * the single identity provider; its JWT carries `sub: "github:<id>"`, `login`,
 * `name`, and `avatar` (scope is read:user, so there is no email claim).
 */
export async function resolveCreatorUser(request: Request, env: SessionEnv): Promise<CreatorUser | null> {
  // Legacy: publisher's own KV session (pre-consolidation sign-ins).
  const pub = getCookie(request, "fgs_pub_session");
  if (pub) {
    const raw = await env.SESSIONS.get(`sessions:${pub}`);
    if (raw) {
      try {
        const s = JSON.parse(raw) as {
          github: string; githubId?: number; sub?: string;
          name?: string | null; avatarUrl: string; email?: string | null;
        };
        return {
          github: s.github,
          githubId: s.githubId ?? null,
          sub: s.sub ?? (s.githubId != null ? `github:${s.githubId}` : null),
          name: s.name ?? null,
          avatarUrl: s.avatarUrl,
          email: s.email ?? null,
        };
      } catch {
        // fall through to JWT
      }
    }
  }

  // Canonical: auth-worker JWT.
  const tok = getCookie(request, "fgs_token");
  if (tok && env.JWT_SECRET) {
    const p = await verifyJWT(tok, env.JWT_SECRET);
    if (p && typeof p.login === "string") {
      const sub = typeof p.sub === "string" ? p.sub : null;
      const parsed = sub && sub.startsWith("github:") ? Number(sub.slice("github:".length)) : NaN;
      return {
        github: p.login,
        githubId: Number.isFinite(parsed) ? parsed : null,
        sub,
        name: typeof p.name === "string" ? p.name : null,
        avatarUrl: typeof p.avatar === "string" ? p.avatar : "",
        email: null,
      };
    }
  }
  return null;
}

/** GitHub login of the signed-in creator, from either session source, or null. */
export async function resolveCreator(request: Request, env: SessionEnv): Promise<string | null> {
  return (await resolveCreatorUser(request, env))?.github ?? null;
}
