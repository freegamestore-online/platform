import { describe, expect, it } from 'vitest';
import { mintSessionToken, verifySession } from './auth';
import { handleAdminAuthRoute, resolveCaller } from './caller';
import type { Env } from './env';

// #500: admin CLI sessions are signed by admin itself, so auth's deletion
// watermark cannot refuse them. Account deletion records one here.

const KEY = 'signing-key';

/** In-memory stand-in for the one table these statements touch. */
function fakeDb(): D1Database & { rows: Map<string, number> } {
  const rows = new Map<string, number>();
  const stmt = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    run: async () => ({}),
    first: async () => {
      const at = rows.get(args[0] as string);
      return at === undefined ? null : { revoked_at: at };
    },
    exec: () => {
      const [subject, at] = args as [string, number];
      rows.set(subject, Math.max(rows.get(subject) ?? 0, at));
    },
  });
  return {
    rows,
    prepare: (sql: string) => stmt(sql),
    batch: async (stmts: Array<{ exec: () => void }>) => {
      for (const s of stmts) s.exec();
      return [];
    },
  } as unknown as D1Database & { rows: Map<string, number> };
}

const b64url = (o: unknown) =>
  btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const consoleToken = (sub: string, login: string) =>
  `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub, login })}.sig`;

function env(db: D1Database, meOk = true): Env {
  return {
    SESSION_SIGNING_KEY: KEY,
    DB: db,
    AUTH: {
      fetch: async () =>
        new Response(JSON.stringify({ email: null }), { status: meOk ? 200 : 401 }),
    },
  } as unknown as Env;
}

const revoke = (headers: Record<string, string>) =>
  new Request('https://admin.freegamestore.online/v1/auth/sessions', { method: 'DELETE', headers });

const sleepPast = () => new Promise((r) => setTimeout(r, 1100));

describe('DELETE /v1/auth/sessions', () => {
  it('refuses an anonymous caller and writes nothing', async () => {
    const db = fakeDb();
    const res = await handleAdminAuthRoute(revoke({}), env(db));
    expect(res?.status).toBe(401);
    expect(db.rows.size).toBe(0);
  });

  it('refuses the ambient cookie alone', async () => {
    const db = fakeDb();
    const res = await handleAdminAuthRoute(
      revoke({ Cookie: `__Host-fgs_token=${consoleToken('github:42', 'serge')}` }),
      env(db),
    );
    expect(res?.status).toBe(401);
    expect(db.rows.size).toBe(0);
  });

  it('refuses a console session auth does not vouch for', async () => {
    const db = fakeDb();
    const res = await handleAdminAuthRoute(
      revoke({ 'X-FGS-Token': consoleToken('github:42', 'serge') }),
      env(db, false),
    );
    expect(res?.status).toBe(401);
    expect(db.rows.size).toBe(0);
  });

  it('records a watermark for the caller only, by id and by login', async () => {
    const db = fakeDb();
    const res = await handleAdminAuthRoute(
      revoke({ 'X-FGS-Token': consoleToken('github:42', 'Serge') }),
      env(db),
    );
    expect(res?.status).toBe(200);
    expect([...db.rows.keys()].sort()).toEqual(['gid:42', 'login:serge']);
  });

  it('answers 500, not ok, when the write fails', async () => {
    const db = fakeDb();
    db.batch = async () => {
      throw new Error('d1 down');
    };
    const res = await handleAdminAuthRoute(
      revoke({ 'X-FGS-Token': consoleToken('github:42', 'serge') }),
      env(db),
    );
    expect(res?.status).toBe(500);
  });
});

describe('verifySession after revocation', () => {
  async function revokeFor(db: D1Database, sub: string, login: string) {
    await handleAdminAuthRoute(revoke({ 'X-FGS-Token': consoleToken(sub, login) }), env(db));
  }

  it('refuses a session with a gid issued before the deletion; accepts one issued after', async () => {
    const db = fakeDb();
    const old = await mintSessionToken('serge', KEY, '42');
    expect(await verifySession(old, KEY, db)).not.toBeNull();
    await revokeFor(db, 'github:42', 'serge');
    expect(await verifySession(old, KEY, db)).toBeNull();
    await sleepPast();
    const fresh = await mintSessionToken('serge', KEY, '42');
    expect(await verifySession(fresh, KEY, db)).toEqual({ login: 'serge', githubId: '42' });
  });

  it('refuses a pre-#472 session (no gid) by login, case-insensitively', async () => {
    const db = fakeDb();
    const old = await mintSessionToken('Serge', KEY);
    await revokeFor(db, 'github:42', 'serge');
    expect(await verifySession(old, KEY, db)).toBeNull();
  });

  it('leaves another user, and a new holder of the login with a different id, alone', async () => {
    const db = fakeDb();
    await revokeFor(db, 'github:42', 'serge');
    const other = await mintSessionToken('alice', KEY, '7');
    const reassigned = await mintSessionToken('serge', KEY, '99');
    expect(await verifySession(other, KEY, db)).not.toBeNull();
    expect(await verifySession(reassigned, KEY, db)).not.toBeNull();
  });

  it('refuses the session when the revocation lookup fails', async () => {
    const db = fakeDb();
    db.prepare = () => {
      throw new Error('d1 down');
    };
    const token = await mintSessionToken('serge', KEY, '42');
    expect(await verifySession(token, KEY, db)).toBeNull();
  });

  it('authenticateLogin (resolveCaller) refuses a revoked CLI session', async () => {
    const db = fakeDb();
    const old = await mintSessionToken('serge', KEY, '42');
    const ask = () =>
      resolveCaller(
        new Request('https://admin.freegamestore.online/api/games/chess', {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${old}` },
        }),
        env(db),
      );
    expect((await ask()).login).toBe('serge');
    await revokeFor(db, 'github:42', 'serge');
    expect((await ask()).login).toBeNull();
  });
});
