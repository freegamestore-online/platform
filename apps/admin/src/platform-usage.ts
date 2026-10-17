// Admin cross-game usage dashboard (#351). Port of FreeAppStore's admin usage
// report (#271), for FGS games.
//
// Every number comes from the `fgs_game_analytics` Analytics Engine dataset that
// the host worker writes (#350). This adds no tracking of its own. The page
// lists every registry game, including ones with no views, so the flag for a
// game that's probably missing the loader works.
//
// "Visitors" can't be counted. The loader records no visitor identifier (no
// cookie, no IP stored), so the per-game column is "distinct pages", the same
// stand-in FAS uses. The response says so instead of inventing a number.

import { ANALYTICS_DATASET, type AnalyticsEnv, cfAnalyticsSql, StatsError } from './game-analytics';
import type { RegistryGame } from './registryReader';

export const PLATFORM_DAYS = 30;
const SHORT_WINDOW_DAYS = 7;
const MAX_GAMES_ROWS = 5000;
const MAX_DAILY_ROWS = 50000;

// Prefer the client-recorded time (double2) for replayed events, else the server
// timestamp. Same expression the per-game stats use, so the two views agree.
const EFFECTIVE_TIME = 'if(length(doubles) > 1, fromUnixTimestamp64Milli(toInt64(double2)), timestamp)';

interface TotalsRow {
  views: number;
  distinct_pages: number;
}

export interface GameWindowRow {
  gameId: string;
  views: number;
  distinct_pages: number;
}

export interface GameDailyRow {
  gameId: string;
  t: string;
  views: number;
}

export interface PlatformUsageInput {
  registry: RegistryGame[];
  games7: GameWindowRow[];
  games30: GameWindowRow[];
  totals7: TotalsRow;
  totals30: TotalsRow;
  dailyByGame: GameDailyRow[];
  /** Overridable for tests. */
  now?: Date;
}

export interface PlatformGameUsage {
  id: string;
  name: string;
  status: string | null;
  creatorGithub: string | null;
  views7: number;
  views30: number;
  distinctPages7: number;
  distinctPages30: number;
  /** 30 daily view counts, oldest first, zero-filled. */
  daily: number[];
  /** No views in the 30-day window: most likely the loader isn't in the game. */
  flagged: boolean;
}

export interface PlatformUsageBody {
  generatedAt: string;
  days: number;
  /** Visitor identity isn't recorded, so there's no visitor count. */
  visitorsRecorded: false;
  totals: { views7: number; views30: number; distinctPages7: number; distinctPages30: number };
  /** The platform-wide daily series for the same 30-day window, oldest first. */
  daily: Array<{ t: string; views: number }>;
  games: PlatformGameUsage[];
  flaggedCount: number;
}

/** The Analytics Engine SQL for the dashboard. Every window and filter is built
 *  from constants or a validated number, so nothing user-supplied reaches the SQL. */
export function buildPlatformQueries(): Record<string, string> {
  const ds = ANALYTICS_DATASET;
  const since = (days: number) => `${EFFECTIVE_TIME} > NOW() - INTERVAL '${days}' DAY`;
  const pageviews = (days: number) => `WHERE blob2 = 'pageview' AND ${since(days)}`;
  const perGame = (days: number) =>
    `SELECT index1 AS gameId, SUM(_sample_interval) AS views, COUNT(DISTINCT blob3) AS distinct_pages FROM ${ds} ${pageviews(days)} GROUP BY gameId LIMIT ${MAX_GAMES_ROWS}`;
  const totals = (days: number) =>
    `SELECT SUM(_sample_interval) AS views, COUNT(DISTINCT blob3) AS distinct_pages FROM ${ds} ${pageviews(days)}`;
  return {
    games7: perGame(SHORT_WINDOW_DAYS),
    games30: perGame(PLATFORM_DAYS),
    totals7: totals(SHORT_WINDOW_DAYS),
    totals30: totals(PLATFORM_DAYS),
    dailyByGame: `SELECT index1 AS gameId, toStartOfDay(${EFFECTIVE_TIME}) AS t, SUM(_sample_interval) AS views FROM ${ds} ${pageviews(PLATFORM_DAYS)} GROUP BY gameId, t ORDER BY gameId, t LIMIT ${MAX_DAILY_ROWS}`,
  };
}

/** UTC day keys (YYYY-MM-DD), oldest first, ending on `now`'s day. */
export function dayKeys(days: number, now: Date): string[] {
  const dayMs = 86_400_000;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    keys.push(new Date(today - i * dayMs).toISOString().slice(0, 10));
  }
  return keys;
}

/** Turns the SQL rows into the dashboard body. Pure, so the aggregation can be
 *  unit-tested without Analytics Engine. */
export function buildPlatformUsage(input: PlatformUsageInput): PlatformUsageBody {
  const now = input.now ?? new Date();
  const keys = dayKeys(PLATFORM_DAYS, now);
  const byGame7 = new Map(input.games7.map((r) => [r.gameId, r]));
  const byGame30 = new Map(input.games30.map((r) => [r.gameId, r]));

  // One normalised daily map per game, plus the platform total per day.
  const dailyFor = new Map<string, Map<string, number>>();
  const platformByDay = new Map<string, number>();
  for (const row of input.dailyByGame) {
    const day = row.t.slice(0, 10);
    const views = Number(row.views) || 0;
    const perGame = dailyFor.get(row.gameId) ?? new Map<string, number>();
    perGame.set(day, (perGame.get(day) ?? 0) + views);
    dailyFor.set(row.gameId, perGame);
    platformByDay.set(day, (platformByDay.get(day) ?? 0) + views);
  }

  const games: PlatformGameUsage[] = input.registry
    .filter((g) => typeof g.id === 'string' && g.id.length > 0)
    .map((g) => {
      const w7 = byGame7.get(g.id);
      const w30 = byGame30.get(g.id);
      const days = dailyFor.get(g.id);
      const views30 = Number(w30?.views) || 0;
      return {
        id: g.id,
        name: g.name || g.id,
        status: typeof g.status === 'string' ? g.status : null,
        creatorGithub: typeof g.creatorGithub === 'string' ? g.creatorGithub : null,
        views7: Number(w7?.views) || 0,
        views30,
        distinctPages7: Number(w7?.distinct_pages) || 0,
        distinctPages30: Number(w30?.distinct_pages) || 0,
        daily: keys.map((k) => days?.get(k) ?? 0),
        flagged: views30 === 0,
      };
    });

  const daily = keys.map((t) => ({ t, views: platformByDay.get(t) ?? 0 }));
  return {
    generatedAt: now.toISOString(),
    days: PLATFORM_DAYS,
    visitorsRecorded: false,
    totals: {
      views7: Number(input.totals7.views) || 0,
      views30: Number(input.totals30.views) || 0,
      distinctPages7: Number(input.totals7.distinct_pages) || 0,
      distinctPages30: Number(input.totals30.distinct_pages) || 0,
    },
    daily,
    games,
    flaggedCount: games.filter((g) => g.flagged).length,
  };
}

/** Runs the dashboard queries and aggregates them. `registry` comes from the
 *  caller: null means the registry couldn't be read, so no game list is known and
 *  the response is an error, not an empty dashboard. */
export async function getPlatformUsage(
  env: AnalyticsEnv,
  registry: RegistryGame[] | null,
  now: Date = new Date(),
): Promise<{ status: number; body: unknown }> {
  if (!registry) return { status: 503, body: { error: 'registry unavailable' } };
  try {
    const sql = buildPlatformQueries();
    const [games7, games30, totals7, totals30, dailyByGame] = await Promise.all([
      cfAnalyticsSql<{ gameId: string; views: number; distinct_pages: number }>(env, sql.games7),
      cfAnalyticsSql<{ gameId: string; views: number; distinct_pages: number }>(env, sql.games30),
      cfAnalyticsSql<{ views: number; distinct_pages: number }>(env, sql.totals7),
      cfAnalyticsSql<{ views: number; distinct_pages: number }>(env, sql.totals30),
      cfAnalyticsSql<{ gameId: string; t: string; views: number }>(env, sql.dailyByGame),
    ]);
    return {
      status: 200,
      body: buildPlatformUsage({
        registry,
        games7,
        games30,
        totals7: totals7[0] ?? { views: 0, distinct_pages: 0 },
        totals30: totals30[0] ?? { views: 0, distinct_pages: 0 },
        dailyByGame,
        now,
      }),
    };
  } catch (err) {
    if (err instanceof StatsError) return { status: err.status, body: { error: err.message } };
    return { status: 502, body: { error: err instanceof Error ? err.message : 'usage query failed' } };
  }
}

/** The route's decision. Anonymous callers get 401, signed-in non-admins 403, and
 *  admins the dashboard. Kept here, not in the router table, so the gate can be
 *  tested without the whole worker. */
export async function handlePlatformUsage(
  caller: { login: string | null; isAdmin: boolean },
  env: AnalyticsEnv,
  registry: RegistryGame[] | null,
  now?: Date,
): Promise<{ status: number; body: unknown }> {
  if (!caller.login) return { status: 401, body: { error: 'unauthorized' } };
  if (!caller.isAdmin) return { status: 403, body: { error: 'forbidden: admin only' } };
  return getPlatformUsage(env, registry, now);
}
