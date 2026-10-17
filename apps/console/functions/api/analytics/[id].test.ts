import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestGet, onRequestPut } from './[id]';

// #354: the console proxy must reject anonymous callers before anything reaches
// admin, forward the creator's cookie for the ownership check, and pass admin's
// status through (so a 403 for a non-owner stays a 403).

const SECRET = 'test-secret';

function b64url(bytes: Uint8Array | string): string {
  const raw = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  return btoa(String.fromCharCode(...raw))
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

async function signSession(login: string): Promise<string> {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(
    JSON.stringify({ login, sub: 'github:1', exp: Math.floor(Date.now() / 1000) + 3600 }),
  );
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}

const env = { SESSIONS: {} as KVNamespace, JWT_SECRET: SECRET };
const params = { id: 'chess' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('/api/analytics/:id proxy (#354)', () => {
  it('answers 401 and never calls admin when there is no session', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await onRequestGet({
      request: new Request('https://console.freegamestore.online/api/analytics/chess?days=7'),
      env,
      params,
    } as never);
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a malformed game id before calling admin', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const cookie = await signSession('alice');
    const res = await onRequestGet({
      request: new Request('https://console.freegamestore.online/api/analytics/Bad_Id', {
        headers: { Cookie: `__Host-fgs_token=${cookie}` },
      }),
      env,
      params: { id: 'Bad_Id' },
    } as never);
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards the query string and the creator cookie, and passes admin status through', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ error: 'not the game owner' }), { status: 403 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const cookie = await signSession('mallory');
    const res = await onRequestGet({
      request: new Request(
        'https://console.freegamestore.online/api/analytics/chess?days=30&kind=level_won',
        {
          headers: { Cookie: `__Host-fgs_token=${cookie}` },
        },
      ),
      env,
      params,
    } as never);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'not the game owner' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://admin.freegamestore.online/api/games/chess/analytics?days=30&kind=level_won',
    );
    expect((init.headers as Record<string, string>)['X-FGS-Token']).toBe(cookie);
  });

  it('forwards a PUT body to admin', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const cookie = await signSession('alice');
    const res = await onRequestPut({
      request: new Request('https://console.freegamestore.online/api/analytics/chess', {
        method: 'PUT',
        headers: { Cookie: `__Host-fgs_token=${cookie}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ga4: 'G-ABC123' }),
      }),
      env,
      params,
    } as never);
    expect(res.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(JSON.stringify({ ga4: 'G-ABC123' }));
  });

  it('answers 502 with JSON when admin is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('socket hang up');
      }),
    );
    const cookie = await signSession('alice');
    const res = await onRequestGet({
      request: new Request('https://console.freegamestore.online/api/analytics/chess', {
        headers: { Cookie: `__Host-fgs_token=${cookie}` },
      }),
      env,
      params,
    } as never);
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toContain('socket hang up');
  });
});
