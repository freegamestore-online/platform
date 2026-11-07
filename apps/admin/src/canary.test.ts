import { afterEach, describe, expect, it, vi } from 'vitest';
import { mintSessionToken, verifySession } from './auth';
import worker from './index';
import * as publish from './publish';

// The create canary's keyless session (#531) reaches admin only at
// POST /api/provision (a fresh e2e-create-*-test game) and DELETE /api/games/:id
// (that game). Everything else refuses it. Admin cannot verify the session
// itself, so the auth worker is faked here: it answers /canary/authorize.

const SUB = 'canary:freegamestore-online/platform';
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '');
const token = (claims: Record<string, unknown>) => `${b64({ alg: 'HS256' })}.${b64(claims)}.sig`;
const CANARY = token({ typ: 'fgs_canary', sub: SUB, canary: true });

type Seen = { url: string; action?: string; token: string | null }[];

function makeEnv(authorize: { status: number; sub?: string } = { status: 200, sub: SUB }) {
  const seen: Seen = [];
  const AUTH = {
    fetch: async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (url.endsWith('/canary/authorize')) {
        seen.push({
          url,
          action: JSON.parse(String(init?.body)).action,
          token: headers.get('X-FGS-Token'),
        });
        return new Response(JSON.stringify({ sub: authorize.sub }), { status: authorize.status });
      }
      seen.push({ url, token: headers.get('X-FGS-Token') });
      // /me refuses a canary session, as the real one does.
      return new Response('{}', { status: 403 });
    },
  };
  return {
    env: { AUTH, SESSION_SIGNING_KEY: 'k', DB: undefined } as unknown as Parameters<
      typeof worker.fetch
    >[1],
    seen,
  };
}

const call = (path: string, method: string, body?: unknown, tok = CANARY) =>
  new Request(`https://admin.freegamestore.online${path}`, {
    method,
    headers: { 'X-FGS-Token': tok, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

afterEach(() => vi.restoreAllMocks());

describe('POST /api/provision for a canary session', () => {
  it('provisions a fresh canary game owned by the canary sub, taking a daily slot', async () => {
    const provision = vi
      .spyOn(publish, 'handlePublish')
      .mockResolvedValue({ success: true, steps: [] });
    const { env, seen } = makeEnv();
    const res = await worker.fetch(
      call('/api/provision', 'POST', {
        id: 'e2e-create-mcp-abc-test',
        name: 'Canary',
        category: 'arcade',
        template: 'canvas',
        // None of these may be honoured.
        creatorGithub: 'attacker',
        cloneFrom: 'chess',
        creatorSub: 'canary:somewhere/else',
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(seen.filter((s) => s.action === 'create')).toHaveLength(1);
    const req = provision.mock.calls[0]?.[0];
    expect(req?.id).toBe('e2e-create-mcp-abc-test');
    expect(req?.creatorSub).toBe(SUB);
    expect(req?.creatorGithub).toBeUndefined();
    expect(req?.cloneFrom).toBeUndefined();
  });

  it('403s any other id before auth is asked (so no slot is spent)', async () => {
    const provision = vi.spyOn(publish, 'handlePublish');
    for (const id of ['chess', 'e2e-create-x', 'platform', undefined]) {
      const { env, seen } = makeEnv();
      const res = await worker.fetch(call('/api/provision', 'POST', { id, name: 'X' }), env);
      expect(res.status, String(id)).toBe(403);
      expect(seen.filter((s) => s.action)).toEqual([]);
    }
    expect(provision).not.toHaveBeenCalled();
  });

  it('passes on auth refusing the session, and on the daily cap', async () => {
    const provision = vi.spyOn(publish, 'handlePublish');
    const body = { id: 'e2e-create-mcp-abc-test', name: 'Canary' };
    expect(
      (await worker.fetch(call('/api/provision', 'POST', body), makeEnv({ status: 401 }).env))
        .status,
    ).toBe(401);
    expect(
      (await worker.fetch(call('/api/provision', 'POST', body), makeEnv({ status: 429 }).env))
        .status,
    ).toBe(429);
    expect(
      (await worker.fetch(call('/api/provision', 'POST', body), makeEnv({ status: 500 }).env))
        .status,
    ).toBe(502);
    expect(provision).not.toHaveBeenCalled();
  });

  it('is not available on /api/publish', async () => {
    const { env } = makeEnv();
    const res = await worker.fetch(
      call('/api/publish', 'POST', { id: 'e2e-create-mcp-abc-test', name: 'X' }),
      env,
    );
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/games/:id for a canary session', () => {
  it('deletes a canary game as the canary owner', async () => {
    const del = vi.spyOn(publish, 'handleDeleteGame').mockResolvedValue({ ok: true });
    const { env, seen } = makeEnv();
    const res = await worker.fetch(call('/api/games/e2e-create-mcp-abc-test', 'DELETE'), env);
    expect(res.status).toBe(200);
    expect(seen.filter((s) => s.action === 'verify')).toHaveLength(1);
    expect(del).toHaveBeenCalledWith('e2e-create-mcp-abc-test', SUB, expect.anything(), {
      canarySub: SUB,
    });
  });

  it('403s any other game without asking auth or touching anything', async () => {
    const del = vi.spyOn(publish, 'handleDeleteGame');
    for (const id of ['chess', 'e2e-create-x', 'my-e2e-create-x-test']) {
      const { env, seen } = makeEnv();
      const res = await worker.fetch(call(`/api/games/${id}`, 'DELETE'), env);
      expect(res.status, id).toBe(403);
      expect(seen.filter((s) => s.action)).toEqual([]);
    }
    expect(del).not.toHaveBeenCalled();
  });

  it('answers 401 when auth does not vouch for the session', async () => {
    const del = vi.spyOn(publish, 'handleDeleteGame');
    const { env } = makeEnv({ status: 401 });
    const res = await worker.fetch(call('/api/games/e2e-create-mcp-abc-test', 'DELETE'), env);
    expect(res.status).toBe(401);
    expect(del).not.toHaveBeenCalled();
  });
});

describe('every other admin route refuses a canary session', () => {
  const refused: [string, string][] = [
    ['GET', '/api/errors'],
    ['GET', '/api/stats'],
    ['GET', '/api/status'],
    ['GET', '/api/users'],
    ['GET', '/api/allusers'],
    ['GET', '/api/sessions'],
    ['POST', '/api/comp/grant'],
    ['GET', '/api/provision'],
    ['PATCH', '/api/games/e2e-create-mcp-abc-test'],
    ['GET', '/api/games/e2e-create-mcp-abc-test/detail'],
    ['GET', '/api/games/e2e-create-mcp-abc-test/analytics'],
    ['PUT', '/api/games/e2e-create-mcp-abc-test/analytics'],
    ['POST', '/api/admin/transfer-owner'],
    ['POST', '/api/internal/error'],
    ['POST', '/api/ci/test-report'],
    ['POST', '/v1/deploys'],
    ['GET', '/api/a-route-added-later'],
  ];
  for (const [method, path] of refused) {
    it(`${method} ${path}`, async () => {
      const { env } = makeEnv();
      const res = await worker.fetch(call(path, method, method === 'GET' ? undefined : {}), env);
      expect(res.status).toBe(403);
    });
  }

  it('also as a bearer or cookie credential', async () => {
    const { env } = makeEnv();
    const bearer = new Request('https://admin.freegamestore.online/api/errors', {
      headers: { Authorization: `Bearer ${CANARY}` },
    });
    expect((await worker.fetch(bearer, env)).status).toBe(403);
    const cookie = new Request('https://admin.freegamestore.online/api/errors', {
      headers: { Cookie: `__Host-fgs_token=${CANARY}` },
    });
    expect((await worker.fetch(cookie, env)).status).toBe(403);
  });
});

describe('verifySession', () => {
  it('refuses a canary-shaped token even when it is signed with the admin key', async () => {
    // Forge one the only way possible: sign with the real key through the contract.
    const { signHs256Jwt } = await import('../../../contracts/session-jwt/v1/contract');
    const now = Math.floor(Date.now() / 1000);
    for (const claims of [
      { typ: 'fgs_canary', sub: SUB, canary: true },
      { sub: SUB },
      { sub: 'serge-ivo', canary: true },
    ])
      expect(
        await verifySession(await signHs256Jwt({ ...claims, exp: now + 60 }, 'k'), 'k'),
      ).toBeNull();
    // ...while an ordinary admin session still verifies.
    expect(await verifySession(await mintSessionToken('serge-ivo', 'k'), 'k')).toEqual({
      login: 'serge-ivo',
      githubId: null,
    });
  });
});
