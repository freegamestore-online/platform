import { afterEach, describe, expect, it, vi } from 'vitest';
import { stubFetchWithAuth } from '../test/auth-me';
import { onRequest as middleware } from './_middleware';
import { resolveCanarySession, resolveCreatorUser } from './api/_auth';
import { onRequestDelete, onRequestPatch } from './api/games/[id]';

// The keyless create canary's session (#531) may create and delete one throwaway
// e2e-create-*-test game and nothing else. These use the real _auth and a real
// HS256 signature; only the network is stubbed.

const SECRET = 'test-secret-value';
const SUB = 'canary:freegamestore-online/platform';
const enc = new TextEncoder();
const nowSec = () => Math.floor(Date.now() / 1000);

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sign(payload: Record<string, unknown>, secret = SECRET): Promise<string> {
  const h = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const p = b64url(enc.encode(JSON.stringify({ iss: 'freegamestore', ...payload })));
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(new Uint8Array(sig))}`;
}

const canaryToken = (extra: Record<string, unknown> = {}, secret = SECRET) =>
  sign(
    { typ: 'fgs_canary', sub: SUB, canary: true, iat: nowSec(), exp: nowSec() + 900, ...extra },
    secret,
  );
const userToken = () =>
  sign({ sub: 'github:1', login: 'alice', iat: nowSec(), exp: nowSec() + 3600 });

const req = (token: string, path: string, method = 'GET') =>
  new Request(`https://console.freegamestore.online${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Cookie: `__Host-fgs_token=${token}`,
      Origin: 'https://console.freegamestore.online',
    },
  });
const env = { JWT_SECRET: SECRET, SESSIONS: {} } as never;

afterEach(() => vi.unstubAllGlobals());

describe('resolveCanarySession', () => {
  it('accepts a live canary session', async () => {
    expect(await resolveCanarySession(req(await canaryToken(), '/api/create'), env)).toEqual({
      sub: SUB,
    });
  });

  it('refuses everything else: forged, expired, a person, a canary carrying a login', async () => {
    const refused = [
      await canaryToken({}, 'another-secret'),
      await canaryToken({ exp: nowSec() - 5 }),
      await userToken(),
      await canaryToken({ login: 'serge-ivo' }),
      await canaryToken({ sub: 'canary:somewhere/else' }),
      await canaryToken({ canary: 'yes' }),
    ];
    for (const token of refused)
      expect(await resolveCanarySession(req(token, '/api/create'), env)).toBeNull();
  });
});

describe('resolveCreatorUser', () => {
  it('does not treat a canary session as a creator, even if auth said the account is live', async () => {
    stubFetchWithAuth(vi.fn(), 200);
    expect(await resolveCreatorUser(req(await canaryToken(), '/api/me'), env)).toBeNull();
    expect(
      await resolveCreatorUser(req(await canaryToken({ typ: undefined }), '/api/me'), env),
    ).toBeNull();
  });

  it('still resolves an ordinary creator', async () => {
    stubFetchWithAuth(vi.fn(), 200);
    expect((await resolveCreatorUser(req(await userToken(), '/api/me'), env))?.github).toBe(
      'alice',
    );
  });
});

describe('_middleware: a canary session reaches only create and delete', () => {
  const next = () => Promise.resolve(new Response('reached'));
  const run = async (token: string, path: string, method: string) =>
    middleware({ request: req(token, path, method), env, next } as never);

  it('lets POST /api/create and DELETE /api/games/:id through', async () => {
    const t = await canaryToken();
    expect((await run(t, '/api/create', 'POST')).status).toBe(200);
    expect((await run(t, '/api/games/e2e-create-console-a-test', 'DELETE')).status).toBe(200);
  });

  it('403s every other route and method, /auth/* included', async () => {
    const t = await canaryToken();
    const denied: [string, string][] = [
      ['/api/me', 'GET'],
      ['/api/create', 'GET'],
      ['/api/create', 'DELETE'],
      ['/api/check-id', 'GET'],
      ['/api/catalog', 'GET'],
      ['/api/games/e2e-create-console-a-test', 'PATCH'],
      ['/api/games/e2e-create-console-a-test', 'GET'],
      ['/api/games/e2e-create-console-a-test/analytics', 'DELETE'],
      ['/api/analytics/e2e-create-console-a-test', 'PUT'],
      ['/api/client-error', 'POST'],
      ['/auth/me', 'GET'],
      ['/auth/delete', 'POST'],
      ['/auth/agent-handoff', 'POST'],
      ['/auth/logout', 'POST'],
      ['/api/a-route-added-later', 'POST'],
    ];
    for (const [path, method] of denied) {
      const res = await run(t, path, method);
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(await res.json()).toEqual({ error: 'forbidden', reason: 'canary_session' });
    }
  });

  it('refuses a canary-looking token without checking its signature', async () => {
    const forged = await canaryToken({}, 'another-secret');
    expect((await run(forged, '/api/me', 'GET')).status).toBe(403);
  });

  it('leaves ordinary sessions and anonymous requests alone', async () => {
    expect((await run(await userToken(), '/api/me', 'GET')).status).toBe(200);
    const anon = await middleware({
      request: new Request('https://console.freegamestore.online/api/me'),
      env,
      next,
    } as never);
    expect(anon.status).toBe(200);
  });
});

describe('DELETE /api/games/:id', () => {
  const call = async (token: string, id: string, fn = onRequestDelete, method = 'DELETE') =>
    fn({ request: req(token, `/api/games/${id}`, method), env, params: { id } } as never);

  it('forwards a canary delete of a canary game to admin with the session', async () => {
    const t = await canaryToken();
    const admin = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    stubFetchWithAuth(admin, 401); // auth /me would refuse the canary: it must not be needed
    const res = await call(t, 'e2e-create-console-a-test');
    expect(res.status).toBe(200);
    expect(admin).toHaveBeenCalledTimes(1);
    const [url, init] = admin.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://admin.freegamestore.online/api/games/e2e-create-console-a-test');
    expect((init.headers as Record<string, string>)['X-FGS-Token']).toBe(t);
  });

  it('403s the canary deleting any other game, without calling admin', async () => {
    const admin = vi.fn();
    stubFetchWithAuth(admin, 200);
    for (const id of ['chess', 'e2e-create-x', 'my-e2e-create-x-test'])
      expect((await call(await canaryToken(), id)).status).toBe(403);
    expect(admin).not.toHaveBeenCalled();
  });

  it('gives the canary no PATCH', async () => {
    const admin = vi.fn();
    stubFetchWithAuth(admin, 401);
    const res = await call(
      await canaryToken(),
      'e2e-create-console-a-test',
      onRequestPatch,
      'PATCH',
    );
    expect(res.status).toBe(401);
    expect(admin).not.toHaveBeenCalled();
  });
});
