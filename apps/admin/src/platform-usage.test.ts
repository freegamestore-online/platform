import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnalyticsEnv } from './game-analytics';
import {
  buildPlatformQueries,
  buildPlatformUsage,
  dayKeys,
  getPlatformUsage,
  handlePlatformUsage,
  type PlatformUsageInput,
} from './platform-usage';

// #351: the admin-only cross-game usage dashboard. The gate, the query shape and
// the aggregation are tested here; the Analytics Engine call is stubbed.

afterEach(() => {
  vi.unstubAllGlobals();
});

const NOW = new Date('2026-10-18T12:00:00Z');
const REGISTRY = [
  { id: 'chess', name: 'Chess', status: 'live', creatorGithub: 'alice' },
  { id: 'tetris', name: 'Tetris', creatorGithub: 'bob' },
  { id: 'ghost', name: 'Ghost Game' }, // no views at all: must be flagged
];
const CONFIGURED: AnalyticsEnv = {
  DB: undefined as unknown as D1Database,
  CF_ACCOUNT_ID: 'acct',
  CF_ANALYTICS_API_TOKEN: 'tok',
};

function input(overrides: Partial<PlatformUsageInput> = {}): PlatformUsageInput {
  return {
    registry: REGISTRY,
    games7: [
      { gameId: 'chess', views: 40, distinct_pages: 2 },
      { gameId: 'tetris', views: 10, distinct_pages: 1 },
    ],
    games30: [
      { gameId: 'chess', views: 100, distinct_pages: 3 },
      { gameId: 'tetris', views: 25, distinct_pages: 1 },
    ],
    totals7: { views: 50, distinct_pages: 3 },
    totals30: { views: 125, distinct_pages: 4 },
    dailyByGame: [
      { gameId: 'chess', t: '2026-10-18 00:00:00', views: 40 },
      { gameId: 'chess', t: '2026-10-17 00:00:00', views: 60 },
      { gameId: 'tetris', t: '2026-10-18', views: 10 },
    ],
    now: NOW,
    ...overrides,
  };
}

describe('buildPlatformQueries', () => {
  it('reads only the game analytics dataset and only pageviews', () => {
    const sql = buildPlatformQueries();
    for (const q of Object.values(sql)) {
      expect(q).toContain('fgs_game_analytics');
    }
    for (const q of Object.values(sql)) {
      expect(q).toContain("blob2 = 'pageview'");
    }
  });

  it('covers the 7-day and 30-day windows and bounds every result set', () => {
    const sql = buildPlatformQueries();
    expect(sql.games7).toContain("INTERVAL '7' DAY");
    expect(sql.games30).toContain("INTERVAL '30' DAY");
    expect(sql.totals7).toContain("INTERVAL '7' DAY");
    expect(sql.totals30).toContain("INTERVAL '30' DAY");
    expect(sql.games7).toMatch(/LIMIT \d+/);
    expect(sql.dailyByGame).toMatch(/LIMIT \d+/);
  });

  it('groups per game by the index and per day for the series', () => {
    const sql = buildPlatformQueries();
    expect(sql.games30).toContain('GROUP BY gameId');
    expect(sql.dailyByGame).toContain('toStartOfDay');
    expect(sql.dailyByGame).toContain('GROUP BY gameId, t');
  });
});

describe('dayKeys', () => {
  it('returns N UTC day keys, oldest first, ending on the given day', () => {
    const keys = dayKeys(30, NOW);
    expect(keys).toHaveLength(30);
    expect(keys[29]).toBe('2026-10-18');
    expect(keys[0]).toBe('2026-09-19');
  });
});

describe('buildPlatformUsage aggregation', () => {
  it('reports per-game 7- and 30-day views and distinct pages', () => {
    const body = buildPlatformUsage(input());
    const chess = body.games.find((g) => g.id === 'chess')!;
    expect(chess).toMatchObject({
      views7: 40,
      views30: 100,
      distinctPages7: 2,
      distinctPages30: 3,
    });
  });

  it('reports platform totals as given by the totals queries', () => {
    const body = buildPlatformUsage(input());
    expect(body.totals).toEqual({
      views7: 50,
      views30: 125,
      distinctPages7: 3,
      distinctPages30: 4,
    });
  });

  it('counts the same path in two games as two pages (#361)', () => {
    // Both games only have `/`. A platform-wide COUNT(DISTINCT path) says 1.
    const body = buildPlatformUsage(
      input({
        games7: [
          { gameId: 'chess', views: 4, distinct_pages: 1 },
          { gameId: 'tetris', views: 1, distinct_pages: 1 },
        ],
        games30: [
          { gameId: 'chess', views: 9, distinct_pages: 1 },
          { gameId: 'tetris', views: 2, distinct_pages: 1 },
        ],
        totals7: { views: 5, distinct_pages: 1 },
        totals30: { views: 11, distinct_pages: 1 },
      }),
    );
    expect(body.totals).toEqual({ views7: 5, views30: 11, distinctPages7: 2, distinctPages30: 2 });
  });

  it('zero-fills the daily series and normalises both timestamp shapes', () => {
    const body = buildPlatformUsage(input());
    const chess = body.games.find((g) => g.id === 'chess')!;
    expect(chess.daily).toHaveLength(30);
    expect(chess.daily[29]).toBe(40); // 2026-10-18
    expect(chess.daily[28]).toBe(60); // 2026-10-17
    expect(chess.daily[0]).toBe(0);
    const tetris = body.games.find((g) => g.id === 'tetris')!;
    expect(tetris.daily[29]).toBe(10);
  });

  it('platform daily series sums every game for the day', () => {
    const body = buildPlatformUsage(input());
    expect(body.daily).toHaveLength(30);
    expect(body.daily[29]).toEqual({ t: '2026-10-18', views: 50 });
    expect(body.daily[28]).toEqual({ t: '2026-10-17', views: 60 });
  });

  it('flags a registry game with no views in 30 days, and only that game', () => {
    const body = buildPlatformUsage(input());
    expect(body.games.find((g) => g.id === 'ghost')).toMatchObject({ views30: 0, flagged: true });
    expect(body.games.find((g) => g.id === 'chess')!.flagged).toBe(false);
    expect(body.flaggedCount).toBe(1);
  });

  it('lists every registry game, including ones that never had analytics rows', () => {
    const body = buildPlatformUsage(input());
    expect(body.games.map((g) => g.id).sort()).toEqual(['chess', 'ghost', 'tetris']);
  });

  it('states that visitors are not recorded rather than inventing a count', () => {
    const body = buildPlatformUsage(input());
    expect(body.visitorsRecorded).toBe(false);
    expect(body.games[0]).not.toHaveProperty('visitors');
  });

  it('carries status and creator through, as null when absent', () => {
    const body = buildPlatformUsage(input());
    expect(body.games.find((g) => g.id === 'chess')).toMatchObject({
      status: 'live',
      creatorGithub: 'alice',
    });
    expect(body.games.find((g) => g.id === 'ghost')).toMatchObject({
      status: null,
      creatorGithub: null,
    });
  });

  it('ignores analytics rows for games the registry does not list', () => {
    const body = buildPlatformUsage(
      input({ games30: [{ gameId: 'deleted-game', views: 999, distinct_pages: 1 }] }),
    );
    expect(body.games.find((g) => g.id === 'deleted-game')).toBeUndefined();
  });
});

describe('getPlatformUsage', () => {
  it('answers 503 when the registry cannot be read, rather than an empty dashboard', async () => {
    const res = await getPlatformUsage(CONFIGURED, null);
    expect(res.status).toBe(503);
  });

  it('answers 503 when the analytics token is not configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await getPlatformUsage(
      { ...CONFIGURED, CF_ANALYTICS_API_TOKEN: undefined },
      REGISTRY,
    );
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers 502 when the Analytics Engine call fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 })),
    );
    const res = await getPlatformUsage(CONFIGURED, REGISTRY);
    expect(res.status).toBe(502);
  });

  it('runs every query and returns the aggregated dashboard', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: { body?: string }) => {
      const sql = init?.body ?? '';
      let data: unknown[] = [];
      if (sql.includes('toStartOfDay'))
        data = [{ gameId: 'chess', t: '2026-10-18 00:00:00', views: 7 }];
      else if (sql.includes('GROUP BY gameId') && sql.includes("INTERVAL '7' DAY"))
        data = [{ gameId: 'chess', views: 7, distinct_pages: 1 }];
      else if (sql.includes('GROUP BY gameId'))
        data = [{ gameId: 'chess', views: 9, distinct_pages: 2 }];
      else if (sql.includes("INTERVAL '7' DAY")) data = [{ views: 7, distinct_pages: 1 }];
      else data = [{ views: 9, distinct_pages: 2 }];
      return new Response(JSON.stringify({ data }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await getPlatformUsage(CONFIGURED, REGISTRY, NOW);
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    const body = res.body as {
      totals: { views30: number };
      games: Array<{ id: string; views30: number }>;
    };
    expect(body.totals.views30).toBe(9);
    expect(body.games.find((g) => g.id === 'chess')!.views30).toBe(9);
  });
});

describe('handlePlatformUsage (#351 admin-only gate)', () => {
  it('answers 401 to an anonymous caller without querying anything', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await handlePlatformUsage(
      { admin: null, login: null, isAdmin: false },
      CONFIGURED,
      REGISTRY,
    );
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers 403 to a signed-in creator who is not an admin, without querying anything', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await handlePlatformUsage(
      { admin: null, login: 'alice', isAdmin: false },
      CONFIGURED,
      REGISTRY,
    );
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers 403 to a Google session that is not an admin', async () => {
    const res = await handlePlatformUsage(
      { admin: 'someone@example.com', login: null, isAdmin: false },
      CONFIGURED,
      REGISTRY,
    );
    expect(res.status).toBe(403);
  });

  it('serves the dashboard to an admin, whose Google session has no GitHub login (#361)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })),
    );
    const res = await handlePlatformUsage(
      { admin: 'serge.the.dev@gmail.com', login: null, isAdmin: true },
      CONFIGURED,
      REGISTRY,
      NOW,
    );
    expect(res.status).toBe(200);
  });
});
