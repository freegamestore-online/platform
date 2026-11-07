/**
 * The create canary's keyless session (#531). FGS-internal; FAS has nothing like it.
 *
 * `.github/workflows/create-canary.yml` proves who it is with a GitHub Actions
 * OIDC token and trades it at the auth worker (`POST /canary/session`) for an
 * `fgs_token` that is NOT a person: sub `canary:<repo>`, no login, no email, 15
 * minutes. Nothing about it is stored anywhere, so there is nothing to rotate or leak.
 *
 * Two halves live here so the services cannot drift apart:
 *  - what the exchange demands of the OIDC token (`canaryOidcRefusal`), and
 *  - what a canary session may then do: create and delete a throwaway
 *    `e2e-create-*-test` game, and nothing else.
 *
 * The session is deny-by-default everywhere an fgs_token is accepted. A service
 * that has no canary route calls `isCanaryToken` / `isCanarySession` and refuses;
 * only the few places that serve the canary verify it with `isCanarySessionClaims`.
 */
import type { OidcClaims } from '../../github-oidc/v1/contract';

/** Audience the workflow asks GitHub for. Not the deploy audience. */
export const CANARY_AUDIENCE = 'freegamestore-canary';
export const CANARY_REPOSITORY = 'freegamestore-online/platform';
/** Immutable ids (strings, as GitHub puts them in the token); names can be renamed. */
export const CANARY_REPOSITORY_ID = '1306133713';
export const CANARY_OWNER_ID = '281560447';
export const CANARY_WORKFLOW_REF =
  'freegamestore-online/platform/.github/workflows/create-canary.yml@refs/heads/main';
export const CANARY_REF = 'refs/heads/main';
export const CANARY_EVENTS: readonly string[] = ['workflow_dispatch', 'schedule'];

export const CANARY_SUB = `canary:${CANARY_REPOSITORY}`;
/** `typ` of the session. It is neither absent nor `fgs_session`, so the console's
 *  and auth's existing session checks reject it before any canary-aware code runs. */
export const CANARY_TYP = 'fgs_canary';
export const CANARY_SESSION_TTL_S = 900;
/** Creates a day (UTC), across both creation paths. */
export const CANARY_CREATES_PER_DAY = 4;

/** The only ids a canary session may create or delete. Also the console's quota-bypass pattern. */
export const CANARY_GAME_ID_RE = /^e2e-create-[a-z0-9-]+-test$/;

export function isCanaryGameId(id: unknown): id is string {
  return typeof id === 'string' && CANARY_GAME_ID_RE.test(id);
}

/** UTC calendar day, the key of the daily create cap. */
export function canaryDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export type CanaryRefusal =
  | 'bad_signature'
  | 'bad_audience'
  | 'bad_issuer'
  | 'expired'
  | 'bad_token'
  | 'wrong_repository'
  | 'wrong_owner'
  | 'wrong_workflow'
  | 'wrong_ref'
  | 'wrong_event'
  | 'missing_jti'
  | 'replay';

/** Reason code for a `verifyGithubOidc` failure. Never the error text itself. */
export function canaryVerifyRefusal(message: string): CanaryRefusal {
  if (/signature/i.test(message)) return 'bad_signature';
  if (/audience/i.test(message)) return 'bad_audience';
  if (/issuer/i.test(message)) return 'bad_issuer';
  if (/expired/i.test(message)) return 'expired';
  return 'bad_token';
}

/** Why verified OIDC claims may not have a canary session, or null if they may.
 *  Every check is on an immutable id or an exact string. */
export function canaryOidcRefusal(claims: OidcClaims): CanaryRefusal | null {
  if (claims.repository_id !== CANARY_REPOSITORY_ID) return 'wrong_repository';
  if (claims.repository_owner_id !== CANARY_OWNER_ID) return 'wrong_owner';
  if (claims.job_workflow_ref !== CANARY_WORKFLOW_REF) return 'wrong_workflow';
  if (claims.ref !== CANARY_REF) return 'wrong_ref';
  if (!claims.event_name || !CANARY_EVENTS.includes(claims.event_name)) return 'wrong_event';
  if (typeof claims.jti !== 'string' || !claims.jti) return 'missing_jti';
  return null;
}

/** The claims of a canary session minted at `nowS` (epoch seconds). No login, email or avatar. */
export function canarySessionClaims(nowS: number): Record<string, unknown> {
  return {
    typ: CANARY_TYP,
    sub: CANARY_SUB,
    canary: true,
    iat: nowS,
    exp: nowS + CANARY_SESSION_TTL_S,
  };
}

/** Does anything in these claims mark the token as a canary one? The deny signal
 *  used by every service that has no canary route: `canary` claim, `canary:` sub
 *  prefix or the canary `typ`. Any one is enough, so a malformed canary token is
 *  refused too rather than slipping through as an unknown kind. */
export function isCanarySession(claims: Record<string, unknown> | null | undefined): boolean {
  if (!claims) return false;
  return (
    claims.canary !== undefined ||
    claims.typ === CANARY_TYP ||
    (typeof claims.sub === 'string' && claims.sub.startsWith('canary:'))
  );
}

/** The allow signal: exactly the shape the exchange mints. Call it on claims
 *  whose HMAC signature and `exp` are already verified. */
export function isCanarySessionClaims(claims: Record<string, unknown> | null | undefined): boolean {
  return (
    !!claims &&
    claims.canary === true &&
    claims.typ === CANARY_TYP &&
    claims.sub === CANARY_SUB &&
    claims.login === undefined &&
    claims.email === undefined
  );
}

/** `isCanarySession` on an unverified token's payload. Safe as a refusal because
 *  refusing on an unproven claim costs a forger nothing: a real token that says so
 *  is refused, a forged one would not have verified anyway. */
export function isCanaryToken(token: string | null | undefined): boolean {
  const part = token?.split('.')[1];
  if (!part) return false;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = new TextDecoder().decode(
      Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0)),
    );
    return isCanarySession(JSON.parse(json) as Record<string, unknown>);
  } catch {
    return false;
  }
}

/** The fgs_token a request presents, from any of the three places services read it. */
export function presentedToken(request: Request): string | null {
  const authz = request.headers.get('Authorization') ?? '';
  return (
    request.headers.get('X-FGS-Token') ||
    (authz.startsWith('Bearer ') ? authz.slice(7).trim() : '') ||
    request.headers.get('Cookie')?.match(/(?:^|;\s*)(?:__Host-)?fgs_token=([^;]+)/)?.[1] ||
    null
  );
}
