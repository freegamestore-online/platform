import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// #81: (1) the legacy fgs_pub_session was checked before the JWT, so a stale
// legacy session shadowed a fresh sign-in, and a legacy-only browser looked
// signed in but forwarded an empty token to admin, so every write failed;
// (2) unguarded fetch / JSON.parse turned upstream hiccups into opaque 500s.

vi.mock('./_games', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./_games')>()),
  listUserGames: vi.fn(async () => ({
    owned: [{ id: 'chess' }],
    isOrgMember: false,
    adminAll: [],
  })),
}));

import { resolveCreatorUser } from './_auth';
import { onRequestPatch } from './games/[id]';
import { onRequestGet as getMe } from './me';
import { onRequestPost as postPublish } from './publish';

const SECRET = 'test-secret';
const enc = new TextEncoder();
const b64url = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

async function jwt(login: string): Promise<string> {
  const h = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const p = b64url(
    enc.encode(
      JSON.stringify({ login, sub: 'github:42', exp: Math.floor(Date.now() / 1000) + 3600 }),
    ),
  );
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${h}.${p}`)));
  return `${h}.${p}.${b64url(sig)}`;
}

function kv(entries: Record<string, string> = {}) {
  return {
    get: vi.fn(async (k: string) => entries[k] ?? null),
    put: vi.fn(),
    delete: vi.fn(),
  } as unknown as KVNamespace;
}

const legacySession = { 'sessions:old': JSON.stringify({ github: 'alice', avatarUrl: '' }) };
const req = (path: string, cookie: string, init: RequestInit = {}) =>
  new Request(`https://console.freegamestore.online${path}`, {
    ...init,
    headers: { Cookie: cookie, Origin: 'https://console.freegamestore.online', ...init.headers },
  });

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('legacy session no longer shadows the JWT (#81)', () => {
  it('a fresh sign-in wins over a stale legacy session for another account', async () => {
    const cookie = `fgs_pub_session=old; __Host-fgs_token=${await jwt('bob')}`;
    const user = await resolveCreatorUser(req('/auth/me', cookie), {
      SESSIONS: kv(legacySession),
      JWT_SECRET: SECRET,
    });
    expect(user?.github).toBe('bob');
  });

  it('a legacy-only browser is signed out, so writes 401 instead of forwarding an empty token', async () => {
    const env = { SESSIONS: kv(legacySession), JWT_SECRET: SECRET };
    expect(await resolveCreatorUser(req('/auth/me', 'fgs_pub_session=old'), env)).toBeNull();

    const res = await onRequestPatch({
      request: req('/api/games/chess', 'fgs_pub_session=old', { method: 'PATCH', body: '{}' }),
      env,
      params: { id: 'chess' },
    } as unknown as Parameters<typeof onRequestPatch>[0]);
    expect(res.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled(); // never reached admin with X-FGS-Token: ''
  });
});

describe('upstream failures return JSON errors, not uncaught 500s (#81)', () => {
  it('PATCH /api/games/:id → 502 JSON with CORS when admin is unreachable', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('network connection lost'));
    const res = await onRequestPatch({
      request: req('/api/games/chess', `__Host-fgs_token=${await jwt('bob')}`, {
        method: 'PATCH',
        body: '{"name":"x"}',
      }),
      env: { SESSIONS: kv(), JWT_SECRET: SECRET },
      params: { id: 'chess' },
    } as unknown as Parameters<typeof onRequestPatch>[0]);
    expect(res.status).toBe(502);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://console.freegamestore.online',
    );
    expect(((await res.json()) as { error: string }).error).toMatch(/network connection lost/);
  });

  it('GET /api/me tolerates a malformed creator record instead of 500ing', async () => {
    const res = await getMe({
      request: req('/api/me', `__Host-fgs_token=${await jwt('bob')}`),
      env: {
        SESSIONS: kv(),
        JWT_SECRET: SECRET,
        CREATORS: kv({ bob: '{not json' }),
        MAX_APPS_PER_USER: '10',
      },
    } as unknown as Parameters<typeof getMe>[0]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { creator: { banned: boolean; games: unknown[] } };
    expect(body.creator.banned).toBe(false);
    expect(body.creator.games).toHaveLength(1);
  });

  it('POST /api/publish → 502 JSON when the provisioning service is unreachable', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('connect timeout'));
    const res = await postPublish({
      request: req('/api/publish', `__Host-fgs_token=${await jwt('bob')}`, {
        method: 'POST',
        body: JSON.stringify({ id: 'chess', name: 'Chess' }),
      }),
      env: { SESSIONS: kv(), JWT_SECRET: SECRET, GITHUB_TOKEN: 't' },
    } as unknown as Parameters<typeof postPublish>[0]);
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toMatch(/connect timeout/);
  });
});
