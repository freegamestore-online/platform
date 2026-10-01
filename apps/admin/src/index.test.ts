import { afterEach, describe, expect, it, vi } from 'vitest';
import { mintSessionToken } from './auth';
import worker from './index';

// Real coverage for the security-critical admin sign-in gate (src/index.ts):
//  - ADMIN_PATHS observability/console routes require an allowlisted Google email
//  - the allowlist match is case + whitespace insensitive
//  - console pages (/, /docs) fall back to the 200 sign-in page, not a 401
//  - the gate FAILS CLOSED when the auth worker is unreachable / non-200
//  - creator self-serve routes (provision/publish/PATCH+DELETE games) are NOT
//    admin-gated — a regression either direction is dangerous.

afterEach(() => {
  vi.restoreAllMocks();
});

/** Build an env whose AUTH service binding resolves `/me` to a chosen email. */
/** Headers of every /me call the worker made through the AUTH binding. */
const authHeaders: Headers[] = [];

function makeEnv(opts: {
  meEmail?: string | null;
  meOk?: boolean;
  authThrows?: boolean;
  adminEmails?: string;
  signingKey?: string;
  internalToken?: string;
  DB?: unknown;
}) {
  const AUTH = {
    fetch: async (_url: unknown, init?: RequestInit) => {
      authHeaders.push(new Headers(init?.headers));
      if (opts.authThrows) throw new Error('auth worker down');
      if (opts.meOk === false) return new Response('bad gateway', { status: 502 });
      return new Response(JSON.stringify({ email: opts.meEmail ?? null }), { status: 200 });
    },
  };
  return {
    AUTH,
    ADMIN_EMAILS: opts.adminEmails,
    SESSION_SIGNING_KEY: opts.signingKey ?? 'test-signing-key',
    INTERNAL_TOKEN: opts.internalToken,
    DB: opts.DB,
  } as unknown as Parameters<typeof worker.fetch>[1];
}

const ADMIN = 'serge.the.dev@gmail.com';
function req(path: string, init?: RequestInit): Request {
  return new Request(`https://admin.freegamestore.online${path}`, init);
}

describe('admin gate — observability/console routes', () => {
  const gatedApis = ['/api/errors', '/api/stats', '/api/users', '/api/status'];

  it('smoke: exports a default fetch handler', () => {
    expect(typeof worker.fetch).toBe('function');
  });

  for (const path of gatedApis) {
    it(`${path} returns 401 JSON for a NON-allowlisted email`, async () => {
      const res = await worker.fetch(
        req(path, { headers: { 'X-FGS-Token': 't' } }),
        makeEnv({ meEmail: 'intruder@example.com', adminEmails: ADMIN, DB: undefined }),
      );
      expect(res.status).toBe(401);
      expect(res.headers.get('Content-Type')).toMatch(/application\/json/);
      expect(await res.json()).toEqual({ error: 'unauthorized' });
    });
  }

  it('returns data (not 401) for an allowlisted email — allowlist is case + whitespace insensitive', async () => {
    // The ADMIN_EMAILS config value carries mixed case AND surrounding whitespace;
    // the verified /me email is the clean lowercase form. They must still match.
    const res = await worker.fetch(
      req('/api/errors', { headers: { 'X-FGS-Token': 't' } }),
      makeEnv({ meEmail: ADMIN, adminEmails: '  Serge.The.Dev@GMAIL.com ', DB: undefined }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]); // listErrors(undefined) → []
  });

  it('matches a mixed-case verified email against a lowercase allowlist entry', async () => {
    const res = await worker.fetch(
      req('/api/errors', { headers: { 'X-FGS-Token': 't' } }),
      makeEnv({ meEmail: 'Serge.The.Dev@GMAIL.com', adminEmails: ADMIN, DB: undefined }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  for (const path of ['/', '/docs']) {
    it(`${path} returns a 200 text/html sign-in page (not 401) for a non-admin`, async () => {
      const res = await worker.fetch(
        req(path, { headers: { 'X-FGS-Token': 't' } }),
        makeEnv({ meEmail: 'intruder@example.com', adminEmails: ADMIN }),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toMatch(/text\/html/);
      const body = await res.text();
      expect(body).toMatch(/Sign in|Google|admin/i);
    });

    it(`${path} returns a 200 sign-in page for a signed-out visitor (no token)`, async () => {
      const res = await worker.fetch(req(path), makeEnv({ adminEmails: ADMIN }));
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toMatch(/text\/html/);
    });
  }
});

describe('admin gate — fails closed', () => {
  it('401 on a gated API when the auth worker THROWS', async () => {
    const res = await worker.fetch(
      req('/api/errors', { headers: { 'X-FGS-Token': 't' } }),
      makeEnv({ authThrows: true, adminEmails: ADMIN, DB: undefined }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });

  it('401 on a gated API when the auth worker returns NON-200', async () => {
    const res = await worker.fetch(
      req('/api/errors', { headers: { 'X-FGS-Token': 't' } }),
      makeEnv({ meOk: false, adminEmails: ADMIN, DB: undefined }),
    );
    expect(res.status).toBe(401);
  });

  it('401 on a gated API when no credential is presented at all', async () => {
    const res = await worker.fetch(
      req('/api/errors'),
      makeEnv({ adminEmails: ADMIN, DB: undefined }),
    );
    expect(res.status).toBe(401);
  });

  it('401 when /me yields no email (e.g. GitHub identity, which carries none)', async () => {
    const res = await worker.fetch(
      req('/api/stats', { headers: { 'X-FGS-Token': 't' } }),
      makeEnv({ meEmail: null, adminEmails: ADMIN, DB: undefined }),
    );
    expect(res.status).toBe(401);
  });
});

describe('/api/errors filter params — user and source', () => {
  /** Build a minimal D1 stub that records the last prepared SQL + bindings. */
  function makeDB(rows: object[] = []) {
    const lastCall: { sql: string; bindings: unknown[] }[] = [];
    return {
      _calls: lastCall,
      prepare(sql: string) {
        const bindings: unknown[] = [];
        return {
          bind(...args: unknown[]) {
            bindings.push(...args);
            return this;
          },
          run: async () => ({ results: [] }),
          all: async () => {
            lastCall.push({ sql, bindings });
            return { results: rows };
          },
          first: async () => null,
        };
      },
    };
  }

  it('passes no WHERE clause when neither user nor source is provided', async () => {
    const db = makeDB();
    const res = await worker.fetch(
      req('/api/errors', { headers: { 'X-FGS-Token': 't' } }),
      makeEnv({ meEmail: ADMIN, adminEmails: ADMIN, DB: db }),
    );
    expect(res.status).toBe(200);
    const call = db._calls[0];
    expect(call).toBeDefined();
    expect(call!.sql).not.toContain('WHERE');
    expect(call!.bindings).toEqual([200]); // just the LIMIT
  });

  it('passes WHERE user_github = ? when ?user= is set', async () => {
    const db = makeDB();
    const res = await worker.fetch(
      req('/api/errors?user=alice', { headers: { 'X-FGS-Token': 't' } }),
      makeEnv({ meEmail: ADMIN, adminEmails: ADMIN, DB: db }),
    );
    expect(res.status).toBe(200);
    const call = db._calls[0];
    expect(call!.sql).toContain('WHERE');
    expect(call!.sql).toContain('user_github = ?');
    expect(call!.bindings).toEqual(['alice', 200]);
  });

  it('passes WHERE source = ? when ?source= is set', async () => {
    const db = makeDB();
    const res = await worker.fetch(
      req('/api/errors?source=console%2Fweb', { headers: { 'X-FGS-Token': 't' } }),
      makeEnv({ meEmail: ADMIN, adminEmails: ADMIN, DB: db }),
    );
    expect(res.status).toBe(200);
    const call = db._calls[0];
    expect(call!.sql).toContain('WHERE');
    expect(call!.sql).toContain('source = ?');
    expect(call!.bindings).toEqual(['console/web', 200]);
  });

  it('combines both filters with AND when both params are set', async () => {
    const db = makeDB();
    const res = await worker.fetch(
      req('/api/errors?user=alice&source=console%2Fweb', { headers: { 'X-FGS-Token': 't' } }),
      makeEnv({ meEmail: ADMIN, adminEmails: ADMIN, DB: db }),
    );
    expect(res.status).toBe(200);
    const call = db._calls[0];
    expect(call!.sql).toContain('user_github = ?');
    expect(call!.sql).toContain('source = ?');
    expect(call!.sql).toContain('AND');
    expect(call!.bindings).toEqual(['alice', 'console/web', 200]);
  });
});

describe('creator self-serve routes are NOT behind the admin gate', () => {
  // A regression that ADDED these to the gate would lock creators out; a
  // regression that REMOVED them from the observability gate would leak data.
  // We prove they are reachable by a NON-admin identity (no allowlisted email),
  // landing in their own per-caller auth rather than the gate's 401.

  it('DELETE /api/games/:id reaches the ownership check for a non-admin session', async () => {
    const key = 'creator-key';
    const token = await mintSessionToken('randocreator', key);
    // Registry read → the game is owned by someone else.
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(
          JSON.stringify({
            content: btoa(
              JSON.stringify({
                games: [{ id: 'chess', name: 'Chess', creatorGithub: 'someone-else' }],
              }),
            ),
            sha: 's',
          }),
          { status: 200 },
        ),
    );
    const res = await worker.fetch(
      req('/api/games/chess', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }),
      makeEnv({ signingKey: key, adminEmails: ADMIN, DB: undefined }),
    );
    // Reached handleDeleteGame (400 ownership), NOT the admin gate's 401.
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error?: string }).error).toMatch(/only the creator/i);
  });

  it('PATCH /api/games/:id reaches the ownership check for a non-admin session', async () => {
    const key = 'creator-key';
    const token = await mintSessionToken('randocreator', key);
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(
          JSON.stringify({
            content: btoa(
              JSON.stringify({
                games: [{ id: 'chess', name: 'Chess', creatorGithub: 'someone-else' }],
              }),
            ),
            sha: 's',
          }),
          { status: 200 },
        ),
    );
    const res = await worker.fetch(
      req('/api/games/chess', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Hacked' }),
      }),
      makeEnv({ signingKey: key, adminEmails: ADMIN, DB: undefined }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error?: string }).error).toMatch(/only the creator/i);
  });

  it('POST /api/provision reaches handlePublish via the trusted internal token (no admin email)', async () => {
    // No user credential at all — the trusted worker-to-worker path. A malformed
    // creatorGithub aborts inside handlePublish (no network), proving the request
    // passed the gate and reached the provision handler.
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (input: unknown) => {
      calls.push(typeof input === 'string' ? input : (input as Request).url);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const res = await worker.fetch(
      req('/api/provision', {
        method: 'POST',
        headers: { 'X-Internal-Token': 'secret', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'chess',
          name: 'Chess',
          category: 'arcade',
          creatorGithub: 'bad name!!',
        }),
      }),
      makeEnv({ internalToken: 'secret', adminEmails: ADMIN, DB: undefined }),
    );
    expect(res.status).toBe(400); // handlePublish success:false, NOT gate 401
    expect(JSON.stringify(await res.json())).toMatch(/invalid creatorgithub/i);
    expect(calls).toHaveLength(0); // aborted before any GitHub call
  });

  it('POST /api/provision answers 409 when the id belongs to another creator (#88)', async () => {
    vi.stubGlobal('fetch', async (input: unknown) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.endsWith('/repos/freegamestore-online/chess')) {
        return new Response(JSON.stringify({ id: 1 }), { status: 200 });
      }
      if (url.includes('/contents/registry.json')) {
        return new Response(
          JSON.stringify({
            content: btoa(JSON.stringify({ games: [{ id: 'chess', creatorGithub: 'alice' }] })),
            sha: 's',
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });
    const res = await worker.fetch(
      req('/api/provision', {
        method: 'POST',
        headers: { 'X-Internal-Token': 'secret', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'chess',
          name: 'Chess',
          category: 'arcade',
          creatorGithub: 'bob',
        }),
      }),
      makeEnv({ internalToken: 'secret', adminEmails: ADMIN, DB: undefined }),
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { conflict?: boolean }).conflict).toBe(true);
  });
});

describe('GET /api/games/:id/detail fork attribution (#44)', () => {
  it('returns the immutable attribution object from the registry', async () => {
    vi.stubGlobal('fetch', async (input: unknown) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/contents/registry.json')) {
        return new Response(
          JSON.stringify({
            games: [
              { id: 'chess', name: 'Chess', creatorGithub: 'original-creator' },
              {
                id: 'chess-remix',
                name: 'Chess Remix',
                creatorGithub: 'remixer',
                forkedFrom: {
                  id: 'chess',
                  name: 'Chess',
                  creatorGithub: 'original-creator',
                  forkedAt: '2026-09-25T00:00:00.000Z',
                },
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ workflow_runs: [] }), { status: 200 });
    });
    const env = {
      ...makeEnv({ meEmail: ADMIN, adminEmails: ADMIN, DB: undefined }),
      GITHUB_TOKEN: 'test-token',
    };
    const res = await worker.fetch(
      req('/api/games/chess-remix/detail', { headers: { 'X-FGS-Token': 't' } }),
      env,
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { forkedFrom?: unknown }).forkedFrom).toEqual({
      id: 'chess',
      name: 'Chess',
      creatorGithub: 'original-creator',
      forkedAt: '2026-09-25T00:00:00.000Z',
    });
  });
});

describe('/me audience binding (#69)', () => {
  it('admin rights are only checked against admin- or MCP-issued sessions', async () => {
    authHeaders.length = 0;
    await worker.fetch(
      req('/api/allusers', { headers: { 'X-FGS-Token': 'tok' } }),
      makeEnv({ meEmail: ADMIN, adminEmails: ADMIN, DB: undefined }),
    );
    expect(authHeaders[0]?.get('X-FGS-Audience')).toBe(
      'https://admin.freegamestore.online,https://mcp.freegamestore.online',
    );
  });

  it('creator actions accept admin, console (forwarded) and MCP sessions only', async () => {
    authHeaders.length = 0;
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 404 }));
    await worker.fetch(
      req('/api/provision', {
        method: 'POST',
        headers: { 'X-FGS-Token': 'tok', 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'bad id!', name: 'x', category: 'arcade' }),
      }),
      makeEnv({ adminEmails: ADMIN, DB: undefined }),
    );
    expect(authHeaders.at(-1)?.get('X-FGS-Audience')).toBe(
      'https://admin.freegamestore.online,https://console.freegamestore.online,https://mcp.freegamestore.online',
    );
  });
});
