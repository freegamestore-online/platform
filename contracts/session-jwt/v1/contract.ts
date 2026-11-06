/**
 * The one HS256 JWT implementation for FGS (#490). Replaces the copies in
 * workers/auth, apps/console/functions/api/_auth.ts, apps/admin/src/auth.ts and
 * the unused verifyFgsJwt in the registry-ownership contract, which each checked
 * a different subset of alg, exp and iss.
 *
 * Verification requires, in order: three base64url segments, `alg: HS256`, a
 * valid HMAC, a numeric unexpired `exp`, and `iss` equal to the expected issuer.
 * Optional `aud` / `typ` checks are exact matches.
 *
 * FGS-internal. FAS has its own implementation; the issuer is what stops a token
 * from one store verifying in the other even if a key were ever equal.
 */

export const FGS_ISSUER = 'freegamestore';

const encoder = new TextEncoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(s: string): Uint8Array {
  // Also accept the standard alphabet: admin sessions minted before #490 used plain btoa.
  if (!/^[A-Za-z0-9_+/-]*$/.test(s)) throw new Error('not base64');
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function hmacKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage],
  );
}

/** Sign `payload` as an HS256 JWT. `iss` defaults to FGS_ISSUER. Fails closed on
 *  an empty key: TextEncoder would otherwise hash a known, forgeable value. */
export async function signHs256Jwt(
  payload: Record<string, unknown>,
  secret: string,
): Promise<string> {
  if (!secret) throw new Error('JWT signing key is not configured');
  const header = bytesToBase64Url(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = bytesToBase64Url(encoder.encode(JSON.stringify({ iss: FGS_ISSUER, ...payload })));
  const sig = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret, 'sign'),
    encoder.encode(`${header}.${body}`),
  );
  return `${header}.${body}.${bytesToBase64Url(new Uint8Array(sig))}`;
}

export interface VerifyOptions {
  /** Expected `iss`. Default FGS_ISSUER. */
  iss?: string;
  /** Accept a token with no `iss` at all (a wrong `iss` is still refused). Only for
   *  sign-in tokens minted before #490 added the claim; drop it once they have all
   *  expired. */
  allowMissingIss?: boolean;
  /** Expected `aud`, exact match. */
  aud?: string;
  /** Expected `typ` claim in the payload, exact match. */
  typ?: string;
}

/** Verify an HS256 JWT; null on anything wrong, never throws. */
export async function verifyHs256Jwt(
  token: string,
  secret: string,
  opts: VerifyOptions = {},
): Promise<Record<string, unknown> | null> {
  try {
    if (!secret) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [h, p, s] = parts as [string, string, string];
    const header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(h))) as { alg?: unknown };
    if (header.alg !== 'HS256') return null;
    const ok = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret, 'verify'),
      base64UrlToBytes(s),
      encoder.encode(`${h}.${p}`),
    );
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(p))) as Record<
      string,
      unknown
    >;
    // A token missing exp (or with a non-numeric one) must not be non-expiring.
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    const iss = opts.iss ?? FGS_ISSUER;
    if (payload.iss === undefined ? !opts.allowMissingIss : payload.iss !== iss) return null;
    if (opts.aud !== undefined && payload.aud !== opts.aud) return null;
    if (opts.typ !== undefined && payload.typ !== opts.typ) return null;
    return payload;
  } catch {
    return null;
  }
}
