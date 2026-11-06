// Self-contained HS256 session auth for freegamestore-admin.
// Pattern vendored from pgs/admin (2026-05-28): the admin Worker mints +
// verifies its OWN sessions with its OWN SESSION_SIGNING_KEY — no
// dependency on FAS's signing key (per the admin-worker-per-store
// principle). `fgs login` exchanges a GitHub token for a session here.

import { githubIdFromSub } from '../../../contracts/registry-ownership/v1/contract';

// Per-IP, in-memory (per isolate) limit on exchanges: each one is a GitHub
// introspection, and this is the one place a stolen GitHub token can be tried.
const EXCHANGE_RATE_LIMIT = 10;
const EXCHANGE_RATE_WINDOW_MS = 60_000;
const exchangeBuckets = new Map<string, { count: number; resetAt: number }>();

function exchangeRateLimited(request: Request): boolean {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const now = Date.now();
  let bucket = exchangeBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + EXCHANGE_RATE_WINDOW_MS };
    exchangeBuckets.set(ip, bucket);
  }
  bucket.count++;
  return bucket.count > EXCHANGE_RATE_LIMIT;
}

/**
 * SECURITY (#458): a GitHub token is accepted only if it was issued to FGS's
 * own OAuth app. This used to call `GET /user`, which is 200 for ANY valid
 * GitHub credential (another app's token, a leaked PAT), so any of them bought
 * an admin session for its owner. The app-authenticated check-token call needs
 * the OAuth app's client secret, which only the auth worker holds — so the
 * verdict (and the login it is for) comes from the auth worker's
 * `POST /token/github` over the service binding, rather than this worker
 * gaining a copy of the secret.
 */
async function verifyGithubToken(
  token: string,
  auth: Fetcher,
): Promise<{ status: number; login?: string; githubId?: string | null }> {
  const res = await auth.fetch('https://auth.freegamestore.online/token/github', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status !== 200) return { status: res.status };
  const body = (await res.json().catch(() => null)) as { login?: unknown; token?: unknown } | null;
  if (typeof body?.login !== 'string' || !body.login) return { status: 502 };
  return { status: 200, login: body.login, githubId: githubIdFromJwt(body.token) };
}

/** The numeric GitHub id in the `sub` (`github:<id>`) of the FGS JWT the auth
 *  worker just minted for this user. Read, not verified: it arrived over the
 *  AUTH service binding, in the same answer as the login we already trust. */
function githubIdFromJwt(jwt: unknown): string | null {
  try {
    const part = typeof jwt === 'string' ? jwt.split('.')[1] : undefined;
    if (!part) return null;
    const payload = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as {
      sub?: unknown;
    };
    return githubIdFromSub(payload.sub);
  } catch {
    return null;
  }
}

/** Admin session token. `sub` is the login; `gid` the numeric GitHub id when
 *  known, so ownership checks can match on the id rather than the mutable,
 *  re-assignable login (#472). */
export async function mintSessionToken(
  login: string,
  signingKey: string,
  githubId: string | null = null,
): Promise<string> {
  // Fail closed: an unset/empty key would make TextEncoder.encode() hash the
  // literal "undefined" — a known, forgeable HMAC key anyone could mint with.
  if (!signingKey) throw new Error('SESSION_SIGNING_KEY is not configured');
  const payload = {
    sub: login,
    ...(githubId ? { gid: githubId } : {}),
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30 days
    iss: 'freegamestore',
  };
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(signingKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=+$/, '');
  const body = btoa(JSON.stringify(payload)).replace(/=+$/, '');
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`${header}.${body}`));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=+$/, '');
  return `${header}.${body}.${sigB64}`;
}

export async function verifySession(
  token: string,
  signingKey: string,
): Promise<{ login: string; githubId: string | null } | null> {
  try {
    // Fail closed if the key is missing — never verify against a "undefined" key.
    if (!signingKey) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(signingKey),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const sig = Uint8Array.from(atob(parts[2]!), (c) => c.charCodeAt(0));
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      sig,
      encoder.encode(`${parts[0]}.${parts[1]}`),
    );
    if (!valid) return null;
    const payload = JSON.parse(atob(parts[1]!)) as { sub: string; gid?: unknown; exp: number };
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    // Tokens minted before #472 carry no gid: ownership falls back to the login.
    const githubId =
      typeof payload.gid === 'string' && /^\d+$/.test(payload.gid) ? payload.gid : null;
    return { login: payload.sub, githubId };
  } catch {
    return null;
  }
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export async function handleAuthExchange(
  request: Request,
  env: { SESSION_SIGNING_KEY: string; AUTH: Fetcher },
): Promise<Response> {
  if (exchangeRateLimited(request)) {
    return new Response(JSON.stringify({ error: 'too many token exchanges, retry later' }), {
      status: 429,
      headers: JSON_HEADERS,
    });
  }
  let body: { githubToken?: string };
  try {
    body = (await request.json()) as { githubToken?: string };
  } catch {
    return new Response(JSON.stringify({ error: 'invalid JSON body' }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }
  if (!body.githubToken) {
    return new Response(JSON.stringify({ error: 'missing githubToken' }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }
  const verdict = await verifyGithubToken(body.githubToken, env.AUTH);
  if (verdict.status !== 200 || !verdict.login) {
    // 401: not issued to FGS's OAuth app. 429 / 503 pass through as they are
    // (rate-limited; exchange unconfigured on auth). Anything else is auth or
    // GitHub being unwell, not a verdict on the token.
    const status = [401, 429, 503].includes(verdict.status) ? verdict.status : 502;
    const error =
      status === 401
        ? 'github token was not issued to this application'
        : `token exchange unavailable (${verdict.status})`;
    return new Response(JSON.stringify({ error }), { status, headers: JSON_HEADERS });
  }
  const sessionToken = await mintSessionToken(
    verdict.login,
    env.SESSION_SIGNING_KEY,
    verdict.githubId,
  );
  return new Response(JSON.stringify({ sessionToken, login: verdict.login }), {
    headers: JSON_HEADERS,
  });
}

export async function handleAuthMe(
  request: Request,
  env: { SESSION_SIGNING_KEY: string },
): Promise<Response> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: JSON_HEADERS,
    });
  }
  const login = (await verifySession(authHeader.slice(7), env.SESSION_SIGNING_KEY))?.login;
  if (!login) {
    return new Response(JSON.stringify({ error: 'invalid or expired session' }), {
      status: 401,
      headers: JSON_HEADERS,
    });
  }
  return new Response(JSON.stringify({ login }), { headers: JSON_HEADERS });
}
