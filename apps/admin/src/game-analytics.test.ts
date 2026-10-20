import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type AnalyticsEnv,
  buildStatsQueries,
  getGameAnalytics,
  parseStatsQuery,
  putGameAnalyticsConfig,
  queryGameStats,
  sqlString,
  validateAnalyticsConfig,
} from './game-analytics';

// #354: owner-only stats and BYO tag config for a game. Owner gating is checked
// against the registry, not the request body.

afterEach(() => {
  vi.unstubAllGlobals();
});

const REGISTRY = [{ id: 'chess', creatorGithub: 'alice' }];
const CONFIGURED: AnalyticsEnv = {
  DB: undefined as unknown as D1Database,
  CF_ACCOUNT_ID: 'acct',
  CF_ANALYTICS_API_TOKEN: 'tok',
};

function fakeDb(row: { ga4: string | null; plausible: string | null } | null = null) {
  const writes: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => row,
        run: async () => {
          writes.push({ sql, args });
          return {};
        },
      }),
    }),
  };
  return { db: db as unknown as D1Database, writes };
}

/** Answers each Analytics Engine query by which column alias it selects. */
function stubAnalyticsEngine(failWith?: number) {
  const fetchMock = vi.fn(async (_url: string, init?: { body?: string }) => {
    if (failWith) return new Response('boom', { status: failWith });
    const sql = init?.body ?? '';
    let data: unknown[] = [];
    if (sql.includes('uniq_paths')) data = [{ views: 12, uniq_paths: 3 }];
    else if (sql.includes('toStartOf')) data = [{ t: '2026-10-17', views: 12 }];
    else if (sql.includes('blob3 AS path')) data = [{ path: '/', views: 9 }];
    else if (sql.includes('blob4 AS referrer')) data = [{ referrer: 'news.example.com', views: 4 }];
    else if (sql.includes('blob5 AS country')) data = [{ country: 'GB', views: 7 }];
    else if (sql.includes('blob6 AS device')) data = [{ device: 'desktop', views: 10 }];
    else if (sql.includes('blob2 AS kind')) data = [{ kind: 'level_won', count: '5' }];
    return new Response(JSON.stringify({ data }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('parseStatsQuery', () => {
  it('defaults to 7 days of pageviews, bucketed by day', () => {
    expect(parseStatsQuery(new URLSearchParams())).toEqual({
      days: 7,
      kind: 'pageview',
      bucket: 'day',
      path: '',
    });
  });

  it('buckets a one-day window by hour and honours an explicit bucket', () => {
    expect(parseStatsQuery(new URLSearchParams('days=1'))).toMatchObject({ bucket: 'hour' });
    expect(parseStatsQuery(new URLSearchParams('days=1&bucket=day'))).toMatchObject({
      bucket: 'day',
    });
  });

  it('clamps days to 1..90', () => {
    expect(parseStatsQuery(new URLSearchParams('days=999'))).toMatchObject({ days: 90 });
    expect(parseStatsQuery(new URLSearchParams('days=0'))).toMatchObject({ days: 1 });
  });

  it('rejects a kind that is not a plain event name', () => {
    expect(parseStatsQuery(new URLSearchParams("kind=x' OR 1=1"))).toEqual({
      error: 'invalid kind',
    });
  });

  it('caps the path filter at 256 characters', () => {
    const q = parseStatsQuery(new URLSearchParams(`path=${'a'.repeat(300)}`));
    expect('path' in q && q.path).toHaveLength(256);
  });
});

describe('sqlString and buildStatsQueries', () => {
  it('escapes quotes and backslashes in a literal', () => {
    expect(sqlString("a'b\\c")).toBe("'a''b\\\\c'");
  });

  it('scopes every query to the game and the requested kind', () => {
    const sql = buildStatsQueries('chess', parseStatsQuery(new URLSearchParams()) as never);
    for (const q of Object.values(sql)) {
      expect(q).toContain("index1 = 'chess'");
      expect(q).toContain('fgs_game_analytics');
    }
    expect(sql.totals).toContain("blob2 = 'pageview'");
  });

  it('escapes a hostile path filter so it cannot break out of the literal', () => {
    const sql = buildStatsQueries('chess', {
      days: 7,
      kind: 'pageview',
      bucket: 'day',
      path: "/x' OR '1'='1",
    });
    expect(sql.totals).toContain("blob3 = '/x'' OR ''1''=''1'");
  });

  it('excludes pageviews from the events breakdown', () => {
    const sql = buildStatsQueries('chess', { days: 7, kind: 'pageview', bucket: 'day', path: '' });
    expect(sql.events).toContain("blob2 != 'pageview'");
  });

  it('refuses a game id that fails validation', () => {
    expect(() =>
      buildStatsQueries("chess' --", { days: 7, kind: 'pageview', bucket: 'day', path: '' }),
    ).toThrow('invalid game id');
  });
});

describe('queryGameStats', () => {
  it('shapes the Analytics Engine rows into the stats body', async () => {
    stubAnalyticsEngine();
    const body = await queryGameStats(CONFIGURED, 'chess', {
      days: 7,
      kind: 'pageview',
      bucket: 'day',
      path: '',
    });
    expect(body).toEqual({
      total_views: 12,
      unique_paths: 3,
      series: [{ t: '2026-10-17', views: 12 }],
      top_paths: [{ path: '/', views: 9 }],
      top_referrers: [{ referrer: 'news.example.com', views: 4 }],
      top_countries: [{ country: 'GB', views: 7 }],
      device_split: [{ device: 'desktop', views: 10 }],
      events: [{ kind: 'level_won', count: 5 }],
    });
  });

  it('answers 503 when the stats token is not configured', async () => {
    const fetchMock = stubAnalyticsEngine();
    const res = await getGameAnalytics(
      { DB: fakeDb().db } as AnalyticsEnv,
      'chess',
      'alice',
      REGISTRY,
      new URLSearchParams(),
    );
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers 502 when the Analytics Engine SQL call fails', async () => {
    stubAnalyticsEngine(500);
    const res = await getGameAnalytics(
      { ...CONFIGURED, DB: fakeDb().db },
      'chess',
      'alice',
      REGISTRY,
      new URLSearchParams(),
    );
    expect(res.status).toBe(502);
  });
});

describe('getGameAnalytics owner gating (#354)', () => {
  it('returns the stats and config to the game owner', async () => {
    stubAnalyticsEngine();
    const { db } = fakeDb({ ga4: 'G-ABC123', plausible: null });
    const res = await getGameAnalytics(
      { ...CONFIGURED, DB: db },
      'chess',
      'alice',
      REGISTRY,
      new URLSearchParams('days=7'),
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      appId: 'chess',
      days: 7,
      config: { ga4: 'G-ABC123', plausible: null },
      stats: { total_views: 12 },
    });
  });

  it('matches the owner case-insensitively, as GitHub logins are', async () => {
    stubAnalyticsEngine();
    const { db } = fakeDb();
    const res = await getGameAnalytics(
      { ...CONFIGURED, DB: db },
      'chess',
      'ALICE',
      REGISTRY,
      new URLSearchParams(),
    );
    expect(res.status).toBe(200);
  });

  it('answers 403 to a signed-in user who does not own the game, without querying stats', async () => {
    const fetchMock = stubAnalyticsEngine();
    const { db } = fakeDb();
    const res = await getGameAnalytics(
      { ...CONFIGURED, DB: db },
      'chess',
      'mallory',
      REGISTRY,
      new URLSearchParams(),
    );
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers 404 for a game that is not in the registry', async () => {
    const res = await getGameAnalytics(
      { ...CONFIGURED, DB: fakeDb().db },
      'ghost',
      'alice',
      REGISTRY,
      new URLSearchParams(),
    );
    expect(res.status).toBe(404);
  });

  it('answers 503 when the registry cannot be read, rather than treating the game as unowned', async () => {
    const res = await getGameAnalytics(
      { ...CONFIGURED, DB: fakeDb().db },
      'chess',
      'alice',
      null,
      new URLSearchParams(),
    );
    expect(res.status).toBe(503);
  });

  it('answers 400 for a malformed game id before touching the registry', async () => {
    const res = await getGameAnalytics(
      { ...CONFIGURED, DB: fakeDb().db },
      'Bad_Id',
      'alice',
      REGISTRY,
      new URLSearchParams(),
    );
    expect(res.status).toBe(400);
  });
});

describe('validateAnalyticsConfig', () => {
  it('accepts a GA4 id and a Plausible domain', () => {
    expect(
      validateAnalyticsConfig({ ga4: 'G-ABC123', plausible: 'chess.freegamestore.online' }),
    ).toEqual({
      ok: true,
      value: { ga4: 'G-ABC123', plausible: 'chess.freegamestore.online' },
    });
  });

  it('treats null or blank as clearing the field', () => {
    expect(validateAnalyticsConfig({ ga4: null, plausible: '  ' })).toEqual({
      ok: true,
      value: { ga4: null, plausible: null },
    });
  });

  it('rejects a malformed GA4 id, which would otherwise reach the loader', () => {
    expect(validateAnalyticsConfig({ ga4: 'G-"><script>' })).toEqual({
      ok: false,
      error: 'ga4 must look like G-XXXXXXXX',
    });
  });

  it('rejects a Plausible value that is not a domain', () => {
    expect(validateAnalyticsConfig({ plausible: 'not a domain' })).toEqual({
      ok: false,
      error: 'plausible must be a domain',
    });
  });

  it('rejects unknown fields so a typo is never silently dropped', () => {
    expect(validateAnalyticsConfig({ ga4: 'G-ABC123', custom_head: '<script>' })).toEqual({
      ok: false,
      error: 'unknown field "custom_head"',
    });
  });

  it('rejects a non-object body', () => {
    expect(validateAnalyticsConfig(['G-ABC123']).ok).toBe(false);
    expect(validateAnalyticsConfig('G-ABC123').ok).toBe(false);
  });
});

describe('putGameAnalyticsConfig', () => {
  it('lets the owner write the BYO tags and never touches the beacon token', async () => {
    // The fake answers the read-back with what was just stored.
    const { db, writes } = fakeDb({ ga4: 'G-ABC123', plausible: null });
    const res = await putGameAnalyticsConfig(
      { ...CONFIGURED, DB: db },
      'chess',
      'alice',
      REGISTRY,
      { ga4: 'G-ABC123' },
      1_000,
    );
    expect(res).toEqual({
      status: 200,
      body: { ok: true, config: { ga4: 'G-ABC123', plausible: null } },
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]!.sql).toContain('ON CONFLICT (game_id)');
    expect(writes[0]!.sql).not.toContain('cf_beacon_token');
    // The trailing flags say which fields were sent: ga4 yes, plausible no.
    expect(writes[0]!.args).toEqual(['chess', 'G-ABC123', null, 1_000, 1, 0]);
  });

  it('refuses a non-owner before validating or writing anything', async () => {
    const { db, writes } = fakeDb();
    const res = await putGameAnalyticsConfig(
      { ...CONFIGURED, DB: db },
      'chess',
      'mallory',
      REGISTRY,
      { ga4: 'G-ABC123' },
    );
    expect(res.status).toBe(403);
    expect(writes).toHaveLength(0);
  });

  it('answers 400 for invalid input without writing', async () => {
    const { db, writes } = fakeDb();
    const res = await putGameAnalyticsConfig(
      { ...CONFIGURED, DB: db },
      'chess',
      'alice',
      REGISTRY,
      { ga4: 'nope' },
    );
    expect(res.status).toBe(400);
    expect(writes).toHaveLength(0);
  });
});

describe('analytics config on real SQL (#361)', () => {
  // Vite's loader doesn't resolve node:sqlite, so it comes through require.
  type Sqlite = {
    DatabaseSync: new (
      path: string,
    ) => {
      exec(sql: string): void;
      prepare(sql: string): {
        run(...args: unknown[]): unknown;
        get(...args: unknown[]): unknown;
      };
    };
  };
  const MODULE = 'node:module';

  /** A D1Database over an in-memory SQLite built from the real migration. */
  async function sqliteDb(): Promise<D1Database | null> {
    const { createRequire } = (await import(/* @vite-ignore */ MODULE)) as {
      createRequire(url: string): (id: string) => unknown;
    };
    const req = createRequire(import.meta.url);
    let sqlite: Sqlite;
    let readFileSync: (p: URL, enc: 'utf8') => string;
    try {
      sqlite = req('node:sqlite') as Sqlite;
      readFileSync = (req('node:fs') as { readFileSync: typeof readFileSync }).readFileSync;
    } catch {
      return null;
    }
    const db = new sqlite.DatabaseSync(':memory:');
    db.exec(
      readFileSync(
        new URL('../../../workers/host/migrations/0002_create_game_analytics.sql', import.meta.url),
        'utf8',
      ),
    );
    return {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          run: async () => db.prepare(sql).run(...args),
          first: async () => db.prepare(sql).get(...args) ?? null,
        }),
      }),
    } as unknown as D1Database;
  }

  it('keeps a saved tag the PUT leaves out, and clears one sent as null', async () => {
    const db = await sqliteDb();
    if (!db) return; // node:sqlite unavailable on this Node
    const env = { ...CONFIGURED, DB: db };
    await putGameAnalyticsConfig(env, 'chess', 'alice', REGISTRY, {
      ga4: 'G-ABC123',
      plausible: 'chess.freegamestore.online',
    });

    const onlyGa4 = await putGameAnalyticsConfig(env, 'chess', 'alice', REGISTRY, {
      ga4: 'G-NEW999',
    });
    expect(onlyGa4).toEqual({
      status: 200,
      body: { ok: true, config: { ga4: 'G-NEW999', plausible: 'chess.freegamestore.online' } },
    });

    const cleared = await putGameAnalyticsConfig(env, 'chess', 'alice', REGISTRY, {
      plausible: null,
    });
    expect(cleared.body).toEqual({ ok: true, config: { ga4: 'G-NEW999', plausible: null } });
  });
});

describe('parseStatsQuery days fallback (#361)', () => {
  it('treats an empty or non-numeric ?days as the default, not 1 day', () => {
    const fallback = parseStatsQuery(new URLSearchParams()) as { days: number };
    expect(parseStatsQuery(new URLSearchParams('days='))).toMatchObject({ days: fallback.days });
    expect(parseStatsQuery(new URLSearchParams('days=abc'))).toMatchObject({
      days: fallback.days,
    });
    expect(fallback.days).toBeGreaterThan(1);
  });
});
