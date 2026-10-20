import { handleAuthExchange, handleAuthMe, verifySession } from './auth';
import type { Env } from './env';

export type CallerCredentials = {
  admin: string | null;
  isAdmin: boolean;
  login: string | null;
};

/** The admin allowlist (verified Google emails). Defaults to the sole owner so
 *  the console is never accidentally left open if the var is unset. */
export function adminEmails(env: Env): string[] {
  return (env.ADMIN_EMAILS || 'serge.the.dev@gmail.com')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// Session audiences /me may accept for each kind of caller (#69).
export const ADMIN_AUDIENCES =
  'https://admin.freegamestore.online,https://mcp.freegamestore.online';
export const LOGIN_AUDIENCES =
  'https://admin.freegamestore.online,https://console.freegamestore.online,https://mcp.freegamestore.online';

/** Resolve the signed-in user's verified email via the auth worker, and whether
 *  they're an admin. Returns `email: null` when not signed in at all (so the
 *  sign-in page can tell "sign in" from "wrong account"). */
export async function authenticateAdmin(
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

/** Extract the authenticated GitHub login from either credential the platform issues:
 *  1. Bearer admin session token (CLI `fgs login`)
 *  2. fgs_token — as an Authorization Bearer (MCP) OR an fgs_token cookie (console),
 *     verified by the auth worker's /me (single uniform identity, like the other stores). */
export async function authenticateLogin(request: Request, env: Env): Promise<string | null> {
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
export async function resolveCaller(request: Request, env: Env): Promise<CallerCredentials> {
  const [{ email, isAdmin }, login] = await Promise.all([
    authenticateAdmin(request, env),
    authenticateLogin(request, env),
  ]);
  return { admin: email, isAdmin, login };
}

/** Auth transport is deliberately kept ahead of every API/static route. */
export async function handleAdminAuthRoute(request: Request, env: Env): Promise<Response | null> {
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
