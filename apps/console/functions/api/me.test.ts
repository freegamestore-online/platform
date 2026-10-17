import { describe, expect, it, vi } from 'vitest';
import { onRequestGet } from './me';

// The storefront's analytics page (freegamestore.online) calls /api/me to list
// the signed-in creator's games. These pin the first-party CORS headers so that
// read works, and a foreign origin gets no permissive header.

vi.mock('./_games', () => ({
  listUserGames: vi.fn(async () => ({ owned: [{ id: 'chess' }] })),
}));

const SECRET = 'test-secret';

function b64url(bytes: Uint8Array | string): string {
  const raw = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  return btoa(String.fromCharCode(...raw)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function signSession(login: string): Promise<string> {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ login, sub: 'github:1', exp: Math.floor(Date.now() / 1000) + 3600 }));
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

const env = {
  JWT_SECRET: SECRET,
  SESSIONS: {} as KVNamespace,
  CREATORS: { get: async () => null } as unknown as KVNamespace,
  GITHUB_TOKEN: 'x',
  MAX_APPS_PER_USER: '10',
};

describe('/api/me CORS for the storefront (#355)', () => {
  it('answers a signed-in storefront request with first-party CORS headers', async () => {
    const cookie = await signSession('alice');
    const res = await onRequestGet({
      request: new Request('https://console.freegamestore.online/api/me', {
        headers: { Cookie: `__Host-fgs_token=${cookie}`, Origin: 'https://freegamestore.online' },
      }),
      env,
    } as never);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://freegamestore.online');
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    const body = (await res.json()) as { user: string; creator: { games: Array<{ id: string }> } };
    expect(body.user).toBe('alice');
    expect(body.creator.games).toEqual([{ id: 'chess' }]);
  });

  it('keeps the 401 readable from the storefront so it can show a sign-in prompt', async () => {
    const res = await onRequestGet({
      request: new Request('https://console.freegamestore.online/api/me', {
        headers: { Origin: 'https://freegamestore.online' },
      }),
      env,
    } as never);
    expect(res.status).toBe(401);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://freegamestore.online');
  });

  it('never reflects a foreign origin', async () => {
    const res = await onRequestGet({
      request: new Request('https://console.freegamestore.online/api/me', {
        headers: { Origin: 'https://evil.example' },
      }),
      env,
    } as never);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://console.freegamestore.online');
  });
});
