import { afterEach, describe, expect, it, vi } from 'vitest';
import { stubFetchWithAuth } from '../../test/auth-me';
import { resolveCreatorUser, SESSION_COOKIE, verifyJWT } from './_auth';

// verifyJWT guards every creator API (via resolveCreatorUser). It must:
//  - reject the alg-confusion attacks (alg:"none", alg:"RS256") outright, and
//  - never accept a token whose exp is missing or in the past,
//  - accept only a correctly HS256-signed, unexpired token.

const SECRET = 'test-secret-value';
const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const b64urlStr = (str: string) => b64url(enc.encode(str));

async function hmacSign(signingInput: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(signingInput));
  return b64url(new Uint8Array(sig));
}

/** Build a JWT with an arbitrary header alg, HMAC-signed with `secret`. */
async function makeToken(
  alg: string,
  payload: Record<string, unknown>,
  secret = SECRET,
): Promise<string> {
  const h = b64urlStr(JSON.stringify({ alg, typ: 'JWT' }));
  const p = b64urlStr(JSON.stringify(payload));
  const sig = await hmacSign(`${h}.${p}`, secret);
  return `${h}.${p}.${sig}`;
}

const nowSec = () => Math.floor(Date.now() / 1000);

describe('_auth verifyJWT', () => {
  it('rejects a malformed token (not three parts)', async () => {
    expect(await verifyJWT('only.two', SECRET)).toBeNull();
    expect(await verifyJWT('', SECRET)).toBeNull();
  });

  it("rejects alg:'none' (alg-confusion guard)", async () => {
    const h = b64urlStr(JSON.stringify({ alg: 'none', typ: 'JWT' }));
    const p = b64urlStr(JSON.stringify({ login: 'alice', exp: nowSec() + 3600 }));
    // Classic "none" attack: empty signature segment.
    expect(await verifyJWT(`${h}.${p}.`, SECRET)).toBeNull();
  });

  it("rejects alg:'RS256' even with a valid HMAC signature (alg-confusion guard)", async () => {
    // Header claims RS256 but the token is actually HMAC-signed with the secret.
    // A naive verifier that trusts the header alg could be tricked; this one must
    // reject anything that isn't HS256.
    const token = await makeToken('RS256', { login: 'alice', exp: nowSec() + 3600 });
    expect(await verifyJWT(token, SECRET)).toBeNull();
  });

  it('rejects a valid HS256 signature over a WRONG secret', async () => {
    const token = await makeToken(
      'HS256',
      { login: 'alice', exp: nowSec() + 3600 },
      'other-secret',
    );
    expect(await verifyJWT(token, SECRET)).toBeNull();
  });

  it('rejects a correctly-signed HS256 token with a MISSING exp', async () => {
    const token = await makeToken('HS256', { login: 'alice' });
    expect(await verifyJWT(token, SECRET)).toBeNull();
  });

  it('rejects a correctly-signed HS256 token with a PAST exp', async () => {
    const token = await makeToken('HS256', { login: 'alice', exp: nowSec() - 60 });
    expect(await verifyJWT(token, SECRET)).toBeNull();
  });

  it('rejects a non-numeric exp', async () => {
    const token = await makeToken('HS256', { login: 'alice', exp: '9999999999' });
    expect(await verifyJWT(token, SECRET)).toBeNull();
  });

  it('accepts a correctly-signed HS256 token with a future exp', async () => {
    const token = await makeToken('HS256', {
      login: 'alice',
      sub: 'github:42',
      exp: nowSec() + 3600,
    });
    const payload = await verifyJWT(token, SECRET);
    expect(payload).not.toBeNull();
    expect(payload?.login).toBe('alice');
    expect(payload?.sub).toBe('github:42');
  });
});

describe('_auth resolveCreatorUser token kind (#425)', () => {
  const env = { JWT_SECRET: SECRET } as Parameters<typeof resolveCreatorUser>[1];
  const withCookie = (token: string) =>
    new Request('https://console.freegamestore.online/api/me', {
      headers: { Cookie: `${SESSION_COOKIE}=${token}` },
    });
  const claims = { sub: 'github:1', login: 'octo', exp: nowSec() + 3600 };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepts a console session and a sign-in token', async () => {
    stubFetchWithAuth();
    const session = await makeToken('HS256', {
      ...claims,
      typ: 'fgs_session',
      aud: 'https://console.freegamestore.online',
    });
    expect((await resolveCreatorUser(withCookie(session), env))?.github).toBe('octo');
    const signIn = await makeToken('HS256', claims);
    expect((await resolveCreatorUser(withCookie(signIn), env))?.github).toBe('octo');
  });

  it('rejects a handoff and a session issued for another service', async () => {
    const handoff = await makeToken('HS256', {
      ...claims,
      typ: 'fgs_handoff',
      aud: 'https://console.freegamestore.online',
    });
    expect(await resolveCreatorUser(withCookie(handoff), env)).toBeNull();
    const agentSession = await makeToken('HS256', {
      ...claims,
      typ: 'fgs_session',
      aud: 'https://agent.freegamestore.online',
    });
    expect(await resolveCreatorUser(withCookie(agentSession), env)).toBeNull();
  });

  it('rejects a valid console session auth no longer vouches for: the account was deleted (#499)', async () => {
    stubFetchWithAuth(vi.fn(), 401);
    const session = await makeToken('HS256', {
      ...claims,
      typ: 'fgs_session',
      aud: 'https://console.freegamestore.online',
    });
    expect(await resolveCreatorUser(withCookie(session), env)).toBeNull();
  });

  it('asks auth /me with the token and the console audience (#499)', async () => {
    const calls: Request[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo, init?: RequestInit) => {
      calls.push(new Request(input, init));
      return new Response('{}');
    });
    const signIn = await makeToken('HS256', claims);
    expect((await resolveCreatorUser(withCookie(signIn), env))?.github).toBe('octo');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://auth.freegamestore.online/me');
    expect(calls[0].headers.get('X-FGS-Token')).toBe(signIn);
    expect(calls[0].headers.get('X-FGS-Audience')).toBe('https://console.freegamestore.online');
  });
});
