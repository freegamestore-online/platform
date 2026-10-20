import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './index';
import type { PublishEnv } from './publish';
import { parseTransferBody, transferGameOwner } from './transfer-owner';

// #358: admin-only compare-and-set game ownership transfer, mirroring
// freeappstore-online/platform#274. The owner lives on the registry.json entry
// (creatorGithub); the audit row goes to D1.

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Game = Record<string, unknown>;

/** GitHub stub: registry.json read/write plus /users/:login lookups. */
function stubGitHub(
  registry: Game[],
  opts: { users?: string[]; putStatus?: number; usersDown?: boolean } = {},
) {
  const users = opts.users ?? ['alice', 'Bob', 'carol'];
  const puts: Array<{ message: string; games: Game[] }> = [];
  const fetchFn = vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    const method = init?.method ?? 'GET';
    if (url.includes('registry.json')) {
      if (method === 'GET') {
        return new Response(
          JSON.stringify({ content: btoa(JSON.stringify({ games: registry })), sha: 's1' }),
          { status: 200 },
        );
      }
      const body = JSON.parse(init?.body ?? '{}') as { message: string; content: string };
      const written = JSON.parse(atob(body.content)) as { games: Game[] };
      puts.push({ message: body.message, games: written.games });
      const status = opts.putStatus ?? 200;
      return status === 200
        ? new Response(JSON.stringify({ content: { sha: 's2' } }), { status })
        : new Response(JSON.stringify({ message: 'nope' }), { status });
    }
    const user = url.match(/\/users\/([^/?]+)$/);
    if (user) {
      if (opts.usersDown) return new Response('down', { status: 503 });
      const hit = users.find((u) => u.toLowerCase() === decodeURIComponent(user[1]!).toLowerCase());
      return hit
        ? new Response(JSON.stringify({ login: hit }), { status: 200 })
        : new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
    }
    return new Response('unexpected', { status: 500 });
  });
  vi.stubGlobal('fetch', fetchFn);
  return { puts, fetchFn };
}

/** D1 fake that records every statement and can fail the audit insert. */
function fakeDb(opts: { failInsert?: boolean; rows?: unknown[] } = {}) {
  const runs: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    prepare: (sql: string) => {
      const stmt = (args: unknown[]) => ({
        run: async () => {
          if (opts.failInsert && sql.includes('INSERT')) throw new Error('D1 down');
          runs.push({ sql, args });
          return { meta: { last_row_id: sql.includes('INSERT') ? 7 : 0 } };
        },
        all: async () => {
          runs.push({ sql, args });
          return { results: opts.rows ?? [] };
        },
      });
      return { ...stmt([]), bind: (...args: unknown[]) => stmt(args) };
    },
  };
  return { db: db as unknown as D1Database, runs };
}

const env = (db: D1Database) => ({ GITHUB_TOKEN: 'x', DB: db }) as unknown as PublishEnv;
const INPUT = { game_id: 'chess', from_login: 'alice', to_login: 'bob', reason: 'handover' };

describe('transferGameOwner (#358)', () => {
  it('moves the owner, keeps the display credit in step, and writes an audit row', async () => {
    const { puts } = stubGitHub([
      { id: 'chess', creatorGithub: 'alice', developer: 'alice' },
      { id: 'go', creatorGithub: 'alice', developer: 'alice' },
    ]);
    const { db, runs } = fakeDb();

    const out = await transferGameOwner(env(db), INPUT, 'admin@example.com');

    expect(out).toEqual({
      status: 200,
      body: {
        ok: true,
        game_id: 'chess',
        from_login: 'alice',
        to_login: 'Bob', // GitHub's canonical casing
        owner_login: 'Bob',
        audit_id: 7,
      },
    });
    expect(puts).toHaveLength(1);
    expect(puts[0]!.games[0]).toMatchObject({ creatorGithub: 'Bob', developer: 'Bob' });
    expect(puts[0]!.games[1]).toMatchObject({ creatorGithub: 'alice' }); // others untouched
    expect(puts[0]!.message).toContain('Transfer chess owner from alice to Bob');
    expect(puts[0]!.message).toContain('Admin: admin@example.com');
    expect(puts[0]!.message).toContain('Reason: handover');

    const insert = runs.find((r) => r.sql.includes('INSERT INTO game_owner_transfers'));
    expect(insert?.args.slice(0, 5)).toEqual([
      'chess',
      'alice',
      'Bob',
      'handover',
      'admin@example.com',
    ]);
    expect(typeof insert?.args[5]).toBe('number');
  });

  it('matches from_login case-insensitively and records the stored casing', async () => {
    stubGitHub([{ id: 'chess', creatorGithub: 'Alice' }]);
    const { db, runs } = fakeDb();
    const out = await transferGameOwner(env(db), { ...INPUT, from_login: 'ALICE' }, 'a@x');
    expect(out.status).toBe(200);
    const insert = runs.find((r) => r.sql.includes('INSERT'));
    expect(insert?.args[1]).toBe('Alice');
  });

  it('leaves a custom display credit alone', async () => {
    const { puts } = stubGitHub([{ id: 'chess', creatorGithub: 'alice', developer: 'Chess Co' }]);
    await transferGameOwner(env(fakeDb().db), INPUT, 'a@x');
    expect(puts[0]!.games[0]).toMatchObject({ creatorGithub: 'Bob', developer: 'Chess Co' });
  });

  it('refuses a wrong from_login with the actual owner and writes nothing', async () => {
    const { puts } = stubGitHub([{ id: 'chess', creatorGithub: 'carol' }]);
    const { db, runs } = fakeDb();
    const out = await transferGameOwner(env(db), INPUT, 'a@x');
    expect(out).toEqual({
      status: 409,
      body: { error: 'owner mismatch', game_id: 'chess', owner_login: 'carol' },
    });
    expect(puts).toHaveLength(0);
    expect(runs.some((r) => r.sql.includes('INSERT'))).toBe(false);
  });

  it('refuses a game with no recorded owner', async () => {
    const { puts } = stubGitHub([{ id: 'chess' }]);
    const out = await transferGameOwner(env(fakeDb().db), INPUT, 'a@x');
    expect(out).toEqual({
      status: 409,
      body: { error: 'owner mismatch', game_id: 'chess', owner_login: null },
    });
    expect(puts).toHaveLength(0);
  });

  it('refuses an unknown game', async () => {
    const { puts } = stubGitHub([{ id: 'go', creatorGithub: 'alice' }]);
    const { db, runs } = fakeDb();
    const out = await transferGameOwner(env(db), INPUT, 'a@x');
    expect(out).toEqual({ status: 404, body: { error: 'unknown game', game_id: 'chess' } });
    expect(puts).toHaveLength(0);
    expect(runs).toHaveLength(0);
  });

  it('refuses a to_login that is not a GitHub account', async () => {
    const { puts } = stubGitHub([{ id: 'chess', creatorGithub: 'alice' }]);
    const out = await transferGameOwner(env(fakeDb().db), { ...INPUT, to_login: 'ghost' }, 'a@x');
    expect(out).toEqual({ status: 400, body: { error: 'unknown login', login: 'ghost' } });
    expect(puts).toHaveLength(0);
  });

  it('fails closed when GitHub cannot confirm to_login', async () => {
    const { puts } = stubGitHub([{ id: 'chess', creatorGithub: 'alice' }], { usersDown: true });
    const out = await transferGameOwner(env(fakeDb().db), INPUT, 'a@x');
    expect(out.status).toBe(502);
    expect(puts).toHaveLength(0);
  });

  it('refuses a transfer to the current owner', async () => {
    const { puts } = stubGitHub([{ id: 'chess', creatorGithub: 'alice' }]);
    const out = await transferGameOwner(env(fakeDb().db), { ...INPUT, to_login: 'alice' }, 'a@x');
    expect(out.status).toBe(400);
    expect(puts).toHaveLength(0);
  });

  it('writes no audit row when the registry commit fails', async () => {
    stubGitHub([{ id: 'chess', creatorGithub: 'alice' }], { putStatus: 422 });
    const { db, runs } = fakeDb();
    const out = await transferGameOwner(env(db), INPUT, 'a@x');
    expect(out.status).toBe(502);
    expect(runs.some((r) => r.sql.includes('INSERT'))).toBe(false);
  });

  it('reports a failed audit insert without hiding the committed transfer', async () => {
    const { puts } = stubGitHub([{ id: 'chess', creatorGithub: 'alice' }]);
    const out = await transferGameOwner(env(fakeDb({ failInsert: true }).db), INPUT, 'a@x');
    expect(out.status).toBe(200);
    expect(puts).toHaveLength(1);
    if (out.status !== 200) throw new Error('unreachable');
    expect(out.body.audit_id).toBeNull();
    expect(out.body.audit_error).toMatch(/audit row not written/);
  });

  it('undo is the same call with the logins swapped', async () => {
    const registry: Game[] = [{ id: 'chess', creatorGithub: 'alice' }];
    const { puts } = stubGitHub(registry);
    await transferGameOwner(env(fakeDb().db), INPUT, 'a@x');
    registry[0] = puts[0]!.games[0]!;
    const back = await transferGameOwner(
      env(fakeDb().db),
      { ...INPUT, from_login: 'bob', to_login: 'alice' },
      'a@x',
    );
    expect(back.status).toBe(200);
    expect(puts[1]!.games[0]).toMatchObject({ creatorGithub: 'alice' });
  });
});

describe('parseTransferBody', () => {
  it('accepts a complete body and trims it', () => {
    expect(parseTransferBody({ ...INPUT, reason: '  handover ' })).toEqual({
      ok: true,
      value: INPUT,
    });
  });

  it.each([
    [null, 'expected a JSON object'],
    [[], 'expected a JSON object'],
    [{ ...INPUT, game_id: '' }, 'game_id is required'],
    [{ ...INPUT, game_id: 'Chess!' }, 'invalid game id'],
    [{ ...INPUT, from_login: ' ' }, 'from_login is required'],
    [{ ...INPUT, from_login: '-bad' }, 'invalid from_login'],
    [{ ...INPUT, to_login: '' }, 'to_login is required'],
    [{ ...INPUT, to_login: 'a b' }, 'invalid to_login'],
    [{ ...INPUT, reason: '' }, 'reason is required'],
    [{ ...INPUT, reason: 'x'.repeat(501) }, 'reason is too long'],
  ])('refuses %j', (body, error) => {
    expect(parseTransferBody(body)).toEqual({ ok: false, error });
  });
});

describe('POST /api/admin/transfer-owner gate (#358)', () => {
  const ADMIN = 'serge.the.dev@gmail.com';

  function routeEnv(meEmail: string | null, db: D1Database) {
    return {
      AUTH: {
        fetch: async () =>
          meEmail === null
            ? new Response('no', { status: 401 })
            : new Response(JSON.stringify({ email: meEmail }), { status: 200 }),
      },
      ADMIN_EMAILS: ADMIN,
      SESSION_SIGNING_KEY: 'test-signing-key',
      GITHUB_TOKEN: 'x',
      DB: db,
    } as unknown as Parameters<typeof worker.fetch>[1];
  }

  function post(body: unknown, token: string | null = 't') {
    return new Request('https://admin.freegamestore.online/api/admin/transfer-owner', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'X-FGS-Token': token } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  it('refuses a signed-in non-admin with 403 and touches nothing', async () => {
    const { puts, fetchFn } = stubGitHub([{ id: 'chess', creatorGithub: 'alice' }]);
    const { db, runs } = fakeDb();
    const res = await worker.fetch(post(INPUT), routeEnv('intruder@example.com', db));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'admin session required' });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(puts).toHaveLength(0);
    expect(runs).toHaveLength(0);
  });

  it('refuses an anonymous caller with 401', async () => {
    const { fetchFn } = stubGitHub([{ id: 'chess', creatorGithub: 'alice' }]);
    const res = await worker.fetch(post(INPUT, null), routeEnv(null, fakeDb().db));
    expect(res.status).toBe(401);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('transfers for an admin and returns the audit id', async () => {
    const { puts } = stubGitHub([{ id: 'chess', creatorGithub: 'alice' }]);
    const { db, runs } = fakeDb();
    const res = await worker.fetch(post(INPUT), routeEnv(ADMIN, db));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toMatchObject({ ok: true, owner_login: 'Bob', audit_id: 7 });
    expect(puts).toHaveLength(1);
    const insert = runs.find((r) => r.sql.includes('INSERT'));
    expect(insert?.args[4]).toBe(ADMIN);
  });

  it('passes the compare-and-set refusal through as 409', async () => {
    stubGitHub([{ id: 'chess', creatorGithub: 'carol' }]);
    const res = await worker.fetch(post(INPUT), routeEnv(ADMIN, fakeDb().db));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ owner_login: 'carol' });
  });

  it('answers 400 for a malformed body', async () => {
    stubGitHub([]);
    const res = await worker.fetch(post({ game_id: 'chess' }), routeEnv(ADMIN, fakeDb().db));
    expect(res.status).toBe(400);
  });

  it('lists the audit rows for an admin on GET', async () => {
    const rows = [{ id: 1, game_id: 'chess', from_login: 'alice', to_login: 'Bob' }];
    const res = await worker.fetch(
      new Request('https://admin.freegamestore.online/api/admin/transfer-owner?game_id=chess', {
        headers: { 'X-FGS-Token': 't' },
      }),
      routeEnv(ADMIN, fakeDb({ rows }).db),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ transfers: rows });
  });

  it('refuses the audit list to a non-admin', async () => {
    const res = await worker.fetch(
      new Request('https://admin.freegamestore.online/api/admin/transfer-owner?game_id=chess', {
        headers: { 'X-FGS-Token': 't' },
      }),
      routeEnv('intruder@example.com', fakeDb().db),
    );
    expect(res.status).toBe(403);
  });
});
