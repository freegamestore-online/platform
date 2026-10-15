import { beforeEach, describe, expect, it } from 'vitest';
import worker, { __clearPublishedGameCache } from './index';

// Per-day boards (#161), run against real SQL. D1 calls go through node:sqlite,
// and the schema and migration files are the ones that ship, so the tests catch
// a bad column, index or filter rather than a stub that accepts anything. The
// Workers tsconfig carries no Node types, so the built-ins load by name. node:sqlite
// needs Node >= 22.5; on older Nodes this suite is skipped.
interface SqliteStatement {
  run(...args: unknown[]): { changes: number | bigint };
  get(...args: unknown[]): unknown;
  all(...args: unknown[]): unknown[];
}
interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}
interface SqliteModule {
  DatabaseSync: new (path: string) => SqliteDatabase;
}

// Vite's loader doesn't resolve node:sqlite, so built-ins come through require.
const MODULE = 'node:module';
const { createRequire } = (await import(/* @vite-ignore */ MODULE)) as {
  createRequire(url: string): (id: string) => unknown;
};
const requireNode = createRequire(import.meta.url);
const optional = <T>(id: string): T | null => {
  try {
    return requireNode(id) as T;
  } catch {
    return null;
  }
};
const sqlite = optional<SqliteModule>('node:sqlite');
const fs = optional<{ readFileSync(path: string, encoding: 'utf8'): string }>('node:fs');

const here = (relative: string) => decodeURIComponent(new URL(relative, import.meta.url).pathname);
const read = (relative: string) => fs!.readFileSync(here(relative), 'utf8');

// The scores table as it shipped before periods (schema.sql before #161).
const LEGACY_SCORES_SQL = `
CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,
  player_name TEXT NOT NULL DEFAULT 'Anonymous',
  score INTEGER NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_game_score ON scores(game_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_game_recent ON scores(game_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rate_limit ON scores(ip_hash, game_id, created_at DESC);
`;

const SECRET = 'test-secret';
const LB = 'https://leaderboard.freegamestore.online';
const DAY1 = '2026-10-15';
const DAY2 = '2026-10-16';

const b64url = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/** A real auth-style leaderboard handoff for `game`, for user `sub`. */
async function handoff(game: string, sub: string): Promise<string> {
  const enc = new TextEncoder();
  const h = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const p = b64url(
    enc.encode(
      JSON.stringify({
        typ: 'fgs_handoff',
        aud: LB,
        game,
        sub,
        name: sub,
        exp: Math.floor(Date.now() / 1000) + 300,
      }),
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

/** Adapts node:sqlite to the slice of the D1 API the worker uses. */
function d1(db: SqliteDatabase): D1Database {
  return {
    prepare(sql: string) {
      const stmt = db.prepare(sql);
      return {
        bind(...args: unknown[]) {
          return {
            first: async () => stmt.get(...args) ?? null,
            all: async () => ({ results: stmt.all(...args) }),
            run: async () => ({ meta: { changes: Number(stmt.run(...args).changes) } }),
          };
        },
      };
    },
  } as unknown as D1Database;
}

/** Every game is published, so the routes lookup always passes. */
const ROUTES_DB = {
  prepare: () => ({ bind: () => ({ first: async () => ({ ok: 1 }) }) }),
} as unknown as D1Database;

function env(db: SqliteDatabase) {
  return { DB: d1(db), ROUTES_DB, JWT_SECRET: SECRET } as never;
}

let userSeq = 0;

/** Submit a score as a fresh user, so the 10-second rate limit never applies. */
async function submit(db: SqliteDatabase, game: string, score: number, period?: string) {
  userSeq += 1;
  const sub = `github:${userSeq}`;
  const body: Record<string, unknown> = { game, score };
  if (period !== undefined) body.period = period;
  return worker.fetch(
    new Request(`${LB}/api/scores`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: `https://${game}.freegamestore.online`,
        Authorization: `Bearer ${await handoff(game, sub)}`,
      },
      body: JSON.stringify(body),
    }),
    env(db),
  );
}

async function scoresOf(path: string, db: SqliteDatabase): Promise<number[]> {
  const res = await worker.fetch(new Request(`${LB}${path}`), env(db));
  expect(res.status).toBe(200);
  const data = (await res.json()) as { scores: Array<{ score: number }> };
  return data.scores.map((s) => s.score);
}

const board = (game: string, query: string, db: SqliteDatabase) =>
  scoresOf(`/api/leaderboard/${game}${query}`, db);
const recent = (game: string, query: string, db: SqliteDatabase) =>
  scoresOf(`/api/leaderboard/${game}/recent${query}`, db);

const sqliteAvailable = sqlite !== null && fs !== null;

describe.runIf(sqliteAvailable)('per-day boards on real SQL (#161)', () => {
  const openDb = (): SqliteDatabase => new sqlite!.DatabaseSync(':memory:');
  let db: SqliteDatabase;

  beforeEach(() => {
    __clearPublishedGameCache();
    // A fresh database is built from schema.sql, the same path db:init takes.
    db = openDb();
    db.exec(read('../schema.sql'));
  });

  it('with no period, the board is all-time: daily and free-play scores both count', async () => {
    expect((await submit(db, 'mosaic', 500)).status).toBe(201);
    expect((await submit(db, 'mosaic', 300, DAY1)).status).toBe(201);
    expect(await board('mosaic', '', db)).toEqual([500, 300]);
  });

  it("a period board holds only that day's scores", async () => {
    await submit(db, 'mosaic', 500, DAY1);
    await submit(db, 'mosaic', 300, DAY2);
    await submit(db, 'mosaic', 400, DAY1);
    expect(await board('mosaic', `?period=${DAY1}`, db)).toEqual([500, 400]);
    expect(await board('mosaic', `?period=${DAY2}`, db)).toEqual([300]);
    expect(await board('mosaic', '', db)).toEqual([500, 400, 300]);
  });

  it('the rank on submit counts only scores from that day', async () => {
    const rank = async (res: Response) => ((await res.json()) as { rank: number }).rank;

    expect(await rank(await submit(db, 'mosaic', 500, DAY1))).toBe(1);
    // 500 is higher overall, but on day 2 this 300 is the only score.
    expect(await rank(await submit(db, 'mosaic', 300, DAY2))).toBe(1);
    // On day 1 the 500 beats this 300, so the rank is 2 (not 3 across all days).
    expect(await rank(await submit(db, 'mosaic', 300, DAY1))).toBe(2);
  });

  it('a malformed or impossible period is rejected, and nothing is written', async () => {
    for (const period of ['2026-02-30', 'yesterday', 20261015]) {
      const res = await submit(db, 'mosaic', 100, period as unknown as string);
      expect(res.status, `period ${String(period)}`).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('Invalid period');
    }
    const badDay = new Request(`${LB}/api/leaderboard/mosaic?period=2026-13-01`);
    expect((await worker.fetch(badDay, env(db))).status).toBe(400);
    expect(db.prepare('SELECT COUNT(*) AS n FROM scores').get()).toEqual({ n: 0 });
  });

  it('the recent feed is filtered by period too', async () => {
    await submit(db, 'mosaic', 500, DAY1);
    await submit(db, 'mosaic', 300, DAY2);
    expect(await recent('mosaic', `?period=${DAY1}`, db)).toEqual([500]);
    expect(await recent('mosaic', '', db)).toEqual([300, 500]);
  });

  it('migration 0003 upgrades a pre-period database and leaves existing scores alone', async () => {
    const legacy = openDb();
    legacy.exec(LEGACY_SCORES_SQL);
    legacy.exec(read('../migrations/0001_add_user_id.sql'));
    legacy.exec(read('../migrations/0002_create_users.sql'));
    legacy
      .prepare(
        "INSERT INTO scores (game_id, player_name, score, ip_hash, user_id) VALUES ('chess', 'Old', 700, 'h', 'github:9')",
      )
      .run();

    legacy.exec(read('../migrations/0003_add_period.sql'));

    expect(legacy.prepare("SELECT period FROM scores WHERE player_name = 'Old'").get()).toEqual({
      period: null,
    });
    expect(await board('chess', '', legacy)).toEqual([700]);
    expect(await board('chess', `?period=${DAY1}`, legacy)).toEqual([]);
    const index = legacy
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_game_period'")
      .get();
    expect(index).toEqual({ name: 'idx_game_period' });

    expect((await submit(legacy, 'chess', 650, DAY1)).status).toBe(201);
    expect(await board('chess', `?period=${DAY1}`, legacy)).toEqual([650]);
  });
});
