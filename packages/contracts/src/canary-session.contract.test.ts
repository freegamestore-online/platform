import { describe, expect, it } from 'vitest';
import {
  CANARY_OWNER_ID,
  CANARY_REPOSITORY_ID,
  CANARY_SUB,
  CANARY_WORKFLOW_REF,
  canaryDay,
  canaryOidcRefusal,
  canarySessionClaims,
  canaryVerifyRefusal,
  isCanaryGameId,
  isCanarySession,
  isCanarySessionClaims,
  isCanaryToken,
  presentedToken,
} from '../../../contracts/canary-session/v1/contract';
import type { OidcClaims } from '../../../contracts/github-oidc/v1/contract';

const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '');
const jwt = (claims: unknown) => `${b64({ alg: 'HS256' })}.${b64(claims)}.sig`;

const oidc = (over: Partial<OidcClaims> = {}): OidcClaims => ({
  iss: 'https://token.actions.githubusercontent.com',
  aud: 'freegamestore-canary',
  sub: 'repo:freegamestore-online/platform:ref:refs/heads/main',
  repository: 'freegamestore-online/platform',
  repository_owner: 'freegamestore-online',
  repository_id: CANARY_REPOSITORY_ID,
  repository_owner_id: CANARY_OWNER_ID,
  ref: 'refs/heads/main',
  event_name: 'workflow_dispatch',
  job_workflow_ref: CANARY_WORKFLOW_REF,
  jti: 'j1',
  exp: 1,
  ...over,
});

describe('canary-session contract', () => {
  it('accepts exactly the canary workflow on main', () => {
    expect(canaryOidcRefusal(oidc())).toBeNull();
    expect(canaryOidcRefusal(oidc({ event_name: 'schedule' }))).toBeNull();
  });

  it('refuses each deviation with its own reason code', () => {
    expect(canaryOidcRefusal(oidc({ repository_id: '1' }))).toBe('wrong_repository');
    expect(canaryOidcRefusal(oidc({ repository_owner_id: '1' }))).toBe('wrong_owner');
    expect(canaryOidcRefusal(oidc({ job_workflow_ref: `${CANARY_WORKFLOW_REF}x` }))).toBe(
      'wrong_workflow',
    );
    expect(canaryOidcRefusal(oidc({ ref: 'refs/heads/dev' }))).toBe('wrong_ref');
    expect(canaryOidcRefusal(oidc({ event_name: 'push' }))).toBe('wrong_event');
    expect(canaryOidcRefusal(oidc({ jti: '' }))).toBe('missing_jti');
  });

  it('maps verifier errors to reason codes, never to their text', () => {
    expect(canaryVerifyRefusal('signature verification failed')).toBe('bad_signature');
    expect(canaryVerifyRefusal('bad audience')).toBe('bad_audience');
    expect(canaryVerifyRefusal('bad issuer')).toBe('bad_issuer');
    expect(canaryVerifyRefusal('token expired')).toBe('expired');
    expect(canaryVerifyRefusal('anything else, with detail')).toBe('bad_token');
  });

  it('mints a 15-minute session with no person in it', () => {
    const claims = canarySessionClaims(1000);
    expect(claims).toMatchObject({ sub: CANARY_SUB, canary: true, iat: 1000, exp: 1900 });
    expect(Object.keys(claims).sort()).toEqual(['canary', 'exp', 'iat', 'sub', 'typ']);
    expect(isCanarySessionClaims(claims)).toBe(true);
  });

  it('treats any one canary marker as a canary session (deny), but allows only the exact shape', () => {
    for (const marked of [
      { canary: true },
      { canary: false },
      { typ: 'fgs_canary' },
      { sub: 'canary:anything' },
    ])
      expect(isCanarySession(marked)).toBe(true);
    for (const plain of [{ sub: 'github:1', login: 'a' }, { typ: 'fgs_session' }, {}, null])
      expect(isCanarySession(plain)).toBe(false);
    for (const notQuite of [
      { ...canarySessionClaims(1), login: 'serge-ivo' },
      { ...canarySessionClaims(1), email: 'a@b.c' },
      { ...canarySessionClaims(1), sub: 'canary:other/repo' },
      { ...canarySessionClaims(1), canary: 'true' },
      { ...canarySessionClaims(1), typ: 'fgs_session' },
    ])
      expect(isCanarySessionClaims(notQuite)).toBe(false);
  });

  it('spots a canary token without verifying it, and shrugs at junk', () => {
    expect(isCanaryToken(jwt(canarySessionClaims(1)))).toBe(true);
    expect(isCanaryToken(jwt({ sub: 'github:1' }))).toBe(false);
    for (const junk of [null, undefined, '', 'a', 'a.b', 'a.!!.c', `a.${b64('x')}.c`])
      expect(isCanaryToken(junk)).toBe(false);
  });

  it('finds the presented token in the header, bearer or cookie', () => {
    const at = (headers: Record<string, string>) =>
      presentedToken(new Request('https://x.example/', { headers }));
    expect(at({ 'X-FGS-Token': 'a' })).toBe('a');
    expect(at({ Authorization: 'Bearer b' })).toBe('b');
    expect(at({ Cookie: 'x=1; __Host-fgs_token=c' })).toBe('c');
    expect(at({ Cookie: 'fgs_token=d' })).toBe('d');
    expect(at({})).toBeNull();
  });

  it('game ids: only e2e-create-*-test', () => {
    expect(isCanaryGameId('e2e-create-console-abc-test')).toBe(true);
    for (const id of [
      'chess',
      'e2e-create-x',
      'e2e-create--',
      'xe2e-create-a-test',
      'e2e-create-A-test',
      7,
      undefined,
    ])
      expect(isCanaryGameId(id)).toBe(false);
  });

  it('cap day is the UTC calendar day', () => {
    expect(canaryDay(Date.UTC(2026, 10, 8, 23, 59, 59))).toBe('2026-11-08');
    expect(canaryDay(Date.UTC(2026, 10, 9, 0, 0, 0))).toBe('2026-11-09');
  });
});
