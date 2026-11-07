/**
 * GitHub Actions OIDC verification — zero-dependency, Web Crypto only.
 * FGS-internal: shared by apps/admin (keyless game deploys, #488) and
 * workers/auth (the create-canary session exchange, #531).
 * Ported from proappstore-online/platform packages/build-core (#279, #430) for
 * the keyless game deploy (freegamestore-online/platform#488), as in
 * freeappstore-online/platform packages/backend/src/lib/github-oidc.ts.
 *
 * A workflow with `permissions: id-token: write` can mint a short-lived JWT
 * signed by GitHub (RS256), carrying verifiable claims about *which repo* is
 * running *which workflow*. We verify that JWT here so a repo can authenticate
 * to the platform with NO stored secret — the basis for keyless deploys.
 *
 * Verification: RS256 signature against GitHub's published JWKS, then issuer /
 * audience / expiry checks. Returns the claims (notably `repository` and
 * `repository_owner`) for the caller to authorize against.
 */

const ISSUER = 'https://token.actions.githubusercontent.com';
const JWKS_URL = `${ISSUER}/.well-known/jwks`;
const JWKS_TTL_MS = 10 * 60 * 1000; // GitHub rotates keys; a short cache is safe.
const CLOCK_SKEW_S = 60;

export interface OidcClaims {
  iss: string;
  aud: string | string[];
  sub: string;
  /** e.g. "freegamestore-online/chess" — a name: renamable, so authorize on the ids. */
  repository: string;
  repository_owner: string;
  /** Immutable numeric ids (as strings). */
  repository_id?: string;
  repository_owner_id?: string;
  ref?: string;
  sha?: string;
  event_name?: string;
  run_id?: string;
  jti?: string;
  /** `<owner>/<repo>/<path>@<ref>` of the workflow file the job runs in. */
  job_workflow_ref?: string;
  exp: number;
  iat?: number;
  nbf?: number;
  [k: string]: unknown;
}

export interface VerifyOptions {
  /** The audience the workflow requested; must match exactly. */
  audience: string;
  /** Override current time (ms) — tests only. */
  now?: number;
  /** Override fetch — tests only. */
  fetchImpl?: typeof fetch;
}

type Jwk = JsonWebKey & { kid: string };
let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;
const FORCED_REFRESH_MS = 60 * 1000;
let lastForcedRefresh = 0;

/** Reset the in-memory JWKS cache (tests only). */
export function _resetJwksCache(): void {
  jwksCache = null;
  lastForcedRefresh = 0;
}

function b64urlToBytes(s: string): Uint8Array {
  let t = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = t.length % 4;
  if (pad) t += '='.repeat(4 - pad);
  const bin = atob(t);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlToString(s: string): string {
  return new TextDecoder().decode(b64urlToBytes(s));
}

async function getKeys(fetchImpl: typeof fetch, now: number, forceRefresh = false): Promise<Jwk[]> {
  if (!forceRefresh && jwksCache && now - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.keys;
  const res = await fetchImpl(JWKS_URL);
  if (!res.ok) throw new Error(`JWKS fetch failed (${res.status})`);
  const body = (await res.json()) as { keys: Jwk[] };
  if (!body.keys?.length) throw new Error('JWKS empty');
  jwksCache = { keys: body.keys, fetchedAt: now };
  return body.keys;
}

/**
 * Verify a GitHub Actions OIDC token. Throws on any failure; returns the
 * validated claims on success.
 */
export async function verifyGithubOidc(token: string, opts: VerifyOptions): Promise<OidcClaims> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const nowMs = opts.now ?? Date.now();
  const nowS = Math.floor(nowMs / 1000);

  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed JWT');
  const [h, p, s] = parts as [string, string, string];

  const header = JSON.parse(b64urlToString(h)) as { alg?: string; kid?: string };
  if (header.alg !== 'RS256') throw new Error(`unexpected alg: ${header.alg}`);
  if (!header.kid) throw new Error('missing kid');

  let keys = await getKeys(fetchImpl, nowMs);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk && nowMs - lastForcedRefresh > FORCED_REFRESH_MS) {
    // The signing key may have rotated since we cached the JWKS — a valid token
    // can carry a kid we haven't seen. Force one refetch before rejecting so a
    // routine GitHub key rotation doesn't fail deploys for the cache lifetime;
    // at most once a minute, so unknown kids cannot make every request refetch.
    lastForcedRefresh = nowMs;
    keys = await getKeys(fetchImpl, nowMs, true);
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) throw new Error('signing key not found in JWKS');

  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBytes(s) as BufferSource,
    new TextEncoder().encode(`${h}.${p}`),
  );
  if (!ok) throw new Error('signature verification failed');

  const claims = JSON.parse(b64urlToString(p)) as OidcClaims;
  if (claims.iss !== ISSUER) throw new Error('bad issuer');
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!auds.includes(opts.audience)) throw new Error('bad audience');
  if (typeof claims.exp !== 'number' || claims.exp < nowS) throw new Error('token expired');
  if (typeof claims.nbf === 'number' && claims.nbf > nowS + CLOCK_SKEW_S)
    throw new Error('token not yet valid');
  if (typeof claims.iat === 'number' && claims.iat > nowS + CLOCK_SKEW_S)
    throw new Error('token issued in the future');
  if (!claims.repository || !claims.repository_owner) throw new Error('missing repository claims');

  return claims;
}
