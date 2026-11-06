import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAuthExchange, mintSessionToken, verifySession } from './auth';

// The admin session token (HS256, self-signed by this worker). `fgs login`
// exchanges a GitHub token for one of these; it authenticates the creator CLI +
// admin session. mint → verify round-trips; tampering or expiry → null.

const KEY = 'unit-test-signing-key';

describe('admin session tokens', () => {
  it('mint → verify returns the original login', async () => {
    const token = await mintSessionToken('serge-the-dev', KEY);
    expect(token.split('.')).toHaveLength(3);
    expect(await verifySession(token, KEY)).toBe('serge-the-dev');
  });

  it('rejects a token signed with a different key', async () => {
    const token = await mintSessionToken('serge-the-dev', KEY);
    expect(await verifySession(token, 'some-other-key')).toBeNull();
  });

  it('rejects a token whose payload was tampered with (signature no longer matches)', async () => {
    const token = await mintSessionToken('serge-the-dev', KEY);
    const [header, , sig] = token.split('.');
    // Swap the payload for one claiming to be a different user, keep the old sig.
    const forgedBody = btoa(
      JSON.stringify({
        sub: 'attacker',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).replace(/=+$/, '');
    const forged = `${header}.${forgedBody}.${sig}`;
    expect(await verifySession(forged, KEY)).toBeNull();
  });

  it('rejects a structurally-invalid token', async () => {
    expect(await verifySession('not-a-jwt', KEY)).toBeNull();
    expect(await verifySession('only.two', KEY)).toBeNull();
  });

  it('rejects an expired token (exp in the past) even with a valid signature', async () => {
    // Mint a genuinely-signed token whose exp is already past.
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(KEY),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=+$/, '');
    const body = btoa(
      JSON.stringify({
        sub: 'serge-the-dev',
        iat: 1000,
        exp: Math.floor(Date.now() / 1000) - 60,
        iss: 'freegamestore',
      }),
    ).replace(/=+$/, '');
    const sigBuf = await crypto.subtle.sign('HMAC', key, encoder.encode(`${header}.${body}`));
    const sig = btoa(String.fromCharCode(...new Uint8Array(sigBuf))).replace(/=+$/, '');
    const expired = `${header}.${body}.${sig}`;
    // Sanity: the signature itself is valid — only expiry should fail it.
    expect(await verifySession(expired, KEY)).toBeNull();
  });

  it('fails closed when the signing key is empty (unforgeable-key guard)', async () => {
    const token = await mintSessionToken('serge-the-dev', KEY);
    expect(await verifySession(token, '')).toBeNull();
  });

  it('mintSessionToken throws when the signing key is empty', async () => {
    await expect(mintSessionToken('serge-the-dev', '')).rejects.toThrow(/SESSION_SIGNING_KEY/);
  });
});

// POST /v1/auth/exchange (#458): the GitHub token must have been issued to FGS's
// own OAuth app. The admin Worker holds no OAuth app secret, so the verdict comes
// from the auth worker's /token/github over the AUTH service binding — never
// from GET /user, which is 200 for any valid GitHub credential whatsoever.
describe('handleAuthExchange (#458)', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    // The old code verified with a direct GET https://api.github.com/user. Any
    // direct GitHub call now is the bug coming back.
    globalThis.fetch = vi.fn(async () => {
      throw new Error('direct GitHub call');
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function env(authStatus: number, authBody: unknown) {
    const AUTH = { fetch: vi.fn(async () => Response.json(authBody, { status: authStatus })) };
    return { env: { SESSION_SIGNING_KEY: KEY, AUTH: AUTH as unknown as Fetcher }, AUTH };
  }

  function exchange(ip = `203.0.113.${Math.floor(Math.random() * 250)}`) {
    return new Request('https://admin.freegamestore.online/v1/auth/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
      body: JSON.stringify({ githubToken: 'gh-device-token' }),
    });
  }

  it('mints an admin session for the login the auth worker verified', async () => {
    const { env: e, AUTH } = env(200, { token: 'fgs.jwt.here', login: 'octocat' });
    const res = await handleAuthExchange(exchange(), e);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessionToken: string; login: string };
    expect(body.login).toBe('octocat');
    expect(await verifySession(body.sessionToken, KEY)).toBe('octocat');
    // The user's token went to auth's exchange as the bearer, over the binding.
    expect(AUTH.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = AUTH.fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://auth.freegamestore.online/token/github');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer gh-device-token');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects a GitHub token the auth worker says was not issued to our app', async () => {
    const { env: e } = env(401, { error: 'github token was not issued to this application' });
    const res = await handleAuthExchange(exchange(), e);
    expect(res.status).toBe(401);
    expect((await res.json()) as object).not.toHaveProperty('sessionToken');
  });

  it('does not mint when the auth worker answers 200 without a login', async () => {
    const { env: e } = env(200, { token: 'fgs.jwt.here' });
    const res = await handleAuthExchange(exchange(), e);
    expect(res.status).toBe(502);
    expect((await res.json()) as object).not.toHaveProperty('sessionToken');
  });

  it('passes 503 (exchange unconfigured) through and maps other failures to 502', async () => {
    expect((await handleAuthExchange(exchange(), env(503, {}).env)).status).toBe(503);
    expect((await handleAuthExchange(exchange(), env(500, {}).env)).status).toBe(502);
  });

  it('still 400s a body without githubToken before calling anyone', async () => {
    const { env: e, AUTH } = env(200, { login: 'octocat' });
    const res = await handleAuthExchange(
      new Request('https://admin.freegamestore.online/v1/auth/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }),
      e,
    );
    expect(res.status).toBe(400);
    expect(AUTH.fetch).not.toHaveBeenCalled();
  });

  it('rate-limits exchanges per client IP', async () => {
    const { env: e } = env(401, {});
    const ip = '198.51.100.9';
    for (let i = 0; i < 10; i++)
      expect((await handleAuthExchange(exchange(ip), e)).status).toBe(401);
    expect((await handleAuthExchange(exchange(ip), e)).status).toBe(429);
    expect((await handleAuthExchange(exchange('198.51.100.10'), e)).status).toBe(401);
  });
});
