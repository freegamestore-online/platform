// Per-game owner analytics (#354). Ported from FreeAppStore's
// /v1/apps/:id/analytics/stats (packages/backend/src/routes/analytics.ts) for
// FGS games.
//
// Reads go to the Analytics Engine SQL API against `fgs_game_analytics`, which
// the host worker writes (workers/host/src/analytics.ts). Writes are the owner's
// BYO tags (GA4, Plausible) into the `game_analytics` row the loader reads. The
// beacon token stays platform-owned and is never written here.
//
// Ownership is checked against the registry, the same source of truth that
// PATCH /api/games/:id uses. A non-owner gets 403, an unknown game 404.

import { ownershipFacts } from './publish';

/** A registry entry, as ownershipFacts and the registry reader see it. */
type RegistryGame = Parameters<typeof ownershipFacts>[0] & { id: string };

export const ANALYTICS_DATASET = 'fgs_game_analytics';

const GAME_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/;
const EVENT_KIND_RE = /^[a-z][a-z0-9_]{0,31}$/;
const GA4_RE = /^G-[A-Z0-9]{6,12}$/i;
const DOMAIN_RE = /^[a-z0-9][a-z0-9.-]{0,253}\.[a-z]{2,}$/i;
const PATH_MAX = 256;
const STATS_DAYS_DEFAULT = 7;
const STATS_DAYS_MAX = 90;

export interface GameAnalyticsResult {
  status: number;
  body: unknown;
}

export interface StatsQuery {
  days: number;
  kind: string;
  bucket: 'hour' | 'day';
  path: string;
}

export interface GameAnalyticsConfig {
  ga4: string | null;
  plausible: string | null;
}

export interface StatsBody {
  total_views: number;
  unique_paths: number;
  series: Array<{ t: string; views: number }>;
  top_paths: Array<{ path: string; views: number }>;
  top_referrers: Array<{ referrer: string; views: number }>;
  top_countries: Array<{ country: string; views: number }>;
  device_split: Array<{ device: string; views: number }>;
  /** Custom event kinds (everything except pageview) with their counts. */
  events: Array<{ kind: string; count: number }>;
}

export interface AnalyticsEnv {
  DB: D1Database;
  CF_ACCOUNT_ID?: string;
  CF_ANALYTICS_API_TOKEN?: string;
}

/** Reads a game's owner config. Null fields mean "not set". */
async function readGameAnalyticsConfig(
  db: D1Database,
  gameId: string,
): Promise<GameAnalyticsConfig> {
  const row = await db
    .prepare('SELECT ga4, plausible FROM game_analytics WHERE game_id = ?1')
    .bind(gameId)
    .first<{ ga4: string | null; plausible: string | null }>();
  return { ga4: row?.ga4 ?? null, plausible: row?.plausible ?? null };
}

/** Parses ?days, ?kind, ?bucket and ?path. Out-of-range days are clamped; a bad
 *  kind is an error. An empty or missing value falls back to the default. */
export function parseStatsQuery(params: URLSearchParams): StatsQuery | { error: string } {
  // `?days=` (empty) or a non-number used to become 0 and clamp to 1 day (#361).
  const rawDays = (params.get('days') ?? '').trim();
  const asked = rawDays ? Number(rawDays) : Number.NaN;
  const days = Math.min(
    STATS_DAYS_MAX,
    Math.max(1, Number.isFinite(asked) ? asked | 0 : STATS_DAYS_DEFAULT),
  );
  const kind = (params.get('kind') ?? 'pageview').trim().toLowerCase();
  if (!EVENT_KIND_RE.test(kind)) return { error: 'invalid kind' };
  const bucketParam = (params.get('bucket') ?? '').trim().toLowerCase();
  const bucket: 'hour' | 'day' =
    bucketParam === 'hour' || bucketParam === 'day' ? bucketParam : days <= 1 ? 'hour' : 'day';
  const path = (params.get('path') ?? '').slice(0, PATH_MAX);
  return { days, kind, bucket, path };
}

/** Escapes a value for a single-quoted ClickHouse string literal. Backslashes are
 *  escaped too, since ClickHouse treats them as escape characters. */
export function sqlString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

/** The SQL the stats endpoint runs. Game id and kind are regex-validated before
 *  they get here, and path is escaped with sqlString. */
export function buildStatsQueries(gameId: string, q: StatsQuery): Record<string, string> {
  if (!GAME_ID_RE.test(gameId)) throw new Error('invalid game id');
  // Prefer the client-recorded time in double2 for replayed events, else the
  // server timestamp. Mirrors the FAS query so both stat sets read the same way.
  const effectiveTime =
    'if(length(doubles) > 1, fromUnixTimestamp64Milli(toInt64(double2)), timestamp)';
  const since = `${effectiveTime} > NOW() - INTERVAL '${q.days}' DAY`;
  const pathClause = q.path ? ` AND blob3 = ${sqlString(q.path)}` : '';
  const where = `WHERE index1 = ${sqlString(gameId)} AND blob2 = ${sqlString(q.kind)}${pathClause} AND ${since}`;
  const seriesGroup = q.bucket === 'hour' ? 'toStartOfHour' : 'toStartOfDay';
  const ds = ANALYTICS_DATASET;
  return {
    totals: `SELECT SUM(_sample_interval) AS views, COUNT(DISTINCT blob3) AS uniq_paths FROM ${ds} ${where}`,
    series: `SELECT ${seriesGroup}(${effectiveTime}) AS t, SUM(_sample_interval) AS views FROM ${ds} ${where} GROUP BY t ORDER BY t ASC`,
    paths: `SELECT blob3 AS path, SUM(_sample_interval) AS views FROM ${ds} ${where} GROUP BY path ORDER BY views DESC LIMIT 10`,
    referrers: `SELECT blob4 AS referrer, SUM(_sample_interval) AS views FROM ${ds} ${where} AND blob4 != '' GROUP BY referrer ORDER BY views DESC LIMIT 10`,
    countries: `SELECT blob5 AS country, SUM(_sample_interval) AS views FROM ${ds} ${where} AND blob5 != '' GROUP BY country ORDER BY views DESC LIMIT 10`,
    devices: `SELECT blob6 AS device, SUM(_sample_interval) AS views FROM ${ds} ${where} GROUP BY device`,
    events: `SELECT blob2 AS kind, SUM(_sample_interval) AS count FROM ${ds} WHERE index1 = ${sqlString(gameId)} AND blob2 != 'pageview' AND ${since} GROUP BY kind ORDER BY count DESC LIMIT 20`,
  };
}

export class StatsError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function cfAnalyticsSql<T>(env: AnalyticsEnv, sql: string): Promise<T[]> {
  if (!env.CF_ACCOUNT_ID || !env.CF_ANALYTICS_API_TOKEN) {
    throw new StatsError(
      503,
      'stats not configured (missing CF_ACCOUNT_ID/CF_ANALYTICS_API_TOKEN)',
    );
  }
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.CF_ANALYTICS_API_TOKEN}`,
        'Content-Type': 'text/plain',
      },
      body: sql,
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new StatsError(502, `CF Analytics SQL failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  const json = (await res.json()) as { data?: T[] };
  return json.data ?? [];
}

/** Runs the stats queries in parallel and shapes the response. */
export async function queryGameStats(
  env: AnalyticsEnv,
  gameId: string,
  q: StatsQuery,
): Promise<StatsBody> {
  const sql = buildStatsQueries(gameId, q);
  const [totals, series, paths, refs, ctys, devs, events] = await Promise.all([
    cfAnalyticsSql<{ views: number; uniq_paths: number }>(env, sql.totals),
    cfAnalyticsSql<{ t: string; views: number }>(env, sql.series),
    cfAnalyticsSql<{ path: string; views: number }>(env, sql.paths),
    cfAnalyticsSql<{ referrer: string; views: number }>(env, sql.referrers),
    cfAnalyticsSql<{ country: string; views: number }>(env, sql.countries),
    cfAnalyticsSql<{ device: string; views: number }>(env, sql.devices),
    cfAnalyticsSql<{ kind: string; count: number }>(env, sql.events),
  ]);
  return {
    total_views: Number(totals[0]?.views ?? 0),
    unique_paths: Number(totals[0]?.uniq_paths ?? 0),
    series: series.map((r) => ({ t: r.t, views: Number(r.views) })),
    top_paths: paths.map((r) => ({ path: r.path, views: Number(r.views) })),
    top_referrers: refs.map((r) => ({ referrer: r.referrer, views: Number(r.views) })),
    top_countries: ctys.map((r) => ({ country: r.country, views: Number(r.views) })),
    device_split: devs.map((r) => ({ device: r.device, views: Number(r.views) })),
    events: events.map((r) => ({ kind: r.kind, count: Number(r.count) })),
  };
}

/** Owner check against the registry. Returns an error result unless `login` is
 *  the game's recorded creator. */
function gateOwner(
  gameId: string,
  login: string,
  registry: RegistryGame[] | null,
): GameAnalyticsResult | null {
  if (!GAME_ID_RE.test(gameId)) return { status: 400, body: { error: 'invalid game id' } };
  if (!registry) return { status: 503, body: { error: 'registry unavailable' } };
  const game = registry.find((g) => g?.id === gameId);
  if (!game) return { status: 404, body: { error: 'game not found' } };
  if (
    !ownershipFacts(game, login, { isOrgMember: false, isLegacyAcceptedCollaborator: false })
      .isCreator
  ) {
    return { status: 403, body: { error: 'not the game owner' } };
  }
  return null;
}

/** Why `stats` is null in a GET response (#364). */
export type StatsUnavailable = 'not-configured' | 'unavailable';

/** GET /api/games/:id/analytics — owner-only stats plus the current BYO config.
 *
 *  The tag config is the owner's own data and doesn't depend on Analytics
 *  Engine, so a stats problem never hides it (#364). When the stats token isn't
 *  set (`not-configured`) or the Cloudflare query fails (`unavailable`), the
 *  answer is still 200 with the config, `stats: null` and `statsUnavailable`.
 *  Before, both were a 503/502 with no config: the owner couldn't see their
 *  saved tags, and saving the empty form would clear them. A failed config read
 *  is still an error, since a form that can't show what's saved shouldn't be
 *  offered. */
export async function getGameAnalytics(
  env: AnalyticsEnv,
  gameId: string,
  login: string,
  registry: RegistryGame[] | null,
  params: URLSearchParams,
): Promise<GameAnalyticsResult> {
  const denied = gateOwner(gameId, login, registry);
  if (denied) return denied;
  const parsed = parseStatsQuery(params);
  if ('error' in parsed) return { status: 400, body: { error: parsed.error } };
  try {
    const [statsResult, config] = await Promise.all([
      queryGameStats(env, gameId, parsed).then(
        (stats) => ({ stats, unavailable: undefined }),
        (err: unknown) => {
          const notConfigured = err instanceof StatsError && err.status === 503;
          if (!notConfigured) {
            console.error(`[analytics] stats for ${gameId} failed: ${String(err)}`);
          }
          return {
            stats: null,
            unavailable: (notConfigured ? 'not-configured' : 'unavailable') as StatsUnavailable,
          };
        },
      ),
      readGameAnalyticsConfig(env.DB, gameId),
    ]);
    return {
      status: 200,
      body: {
        appId: gameId,
        days: parsed.days,
        kind: parsed.kind,
        bucket: parsed.bucket,
        path: parsed.path || null,
        config,
        stats: statsResult.stats,
        ...(statsResult.unavailable ? { statsUnavailable: statsResult.unavailable } : {}),
      },
    };
  } catch (err) {
    return {
      status: 502,
      body: { error: err instanceof Error ? err.message : 'config read failed' },
    };
  }
}

/** Validates the owner's BYO tags. Every field is optional; null or empty clears
 *  it. Unknown fields are rejected so a typo can't be silently dropped. */
export function validateAnalyticsConfig(
  input: unknown,
): { ok: true; value: GameAnalyticsConfig } | { ok: false; error: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'body must be a JSON object' };
  }
  const allowed = new Set(['ga4', 'plausible']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) return { ok: false, error: `unknown field "${key}"` };
  }
  const { ga4, plausible } = input as Record<string, unknown>;
  const value: GameAnalyticsConfig = { ga4: null, plausible: null };
  for (const [key, raw] of [
    ['ga4', ga4],
    ['plausible', plausible],
  ] as const) {
    if (raw === undefined) continue;
    if (raw !== null && typeof raw !== 'string')
      return { ok: false, error: `${key} must be a string or null` };
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    if (!trimmed) continue;
    if (key === 'ga4' && !GA4_RE.test(trimmed))
      return { ok: false, error: 'ga4 must look like G-XXXXXXXX' };
    if (key === 'plausible' && !DOMAIN_RE.test(trimmed))
      return { ok: false, error: 'plausible must be a domain' };
    value[key] = trimmed;
  }
  return { ok: true, value };
}

/** PUT /api/games/:id/analytics — owner-only. Writes the BYO tags and leaves the
 *  platform-owned beacon token (cf_beacon_token) untouched. */
export async function putGameAnalyticsConfig(
  env: AnalyticsEnv,
  gameId: string,
  login: string,
  registry: RegistryGame[] | null,
  input: unknown,
  now: number = Date.now(),
): Promise<GameAnalyticsResult> {
  const denied = gateOwner(gameId, login, registry);
  if (denied) return denied;
  const checked = validateAnalyticsConfig(input);
  if (!checked.ok) return { status: 400, body: { error: checked.error } };
  // Only the fields the caller sent are written. A field left out keeps its
  // saved value; before, PUT {"ga4": …} also wiped Plausible (#361).
  const sent = input as Record<string, unknown>;
  const hasGa4 = 'ga4' in sent ? 1 : 0;
  const hasPlausible = 'plausible' in sent ? 1 : 0;
  let saved: GameAnalyticsConfig;
  try {
    await env.DB.prepare(
      `INSERT INTO game_analytics (game_id, ga4, plausible, updated_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (game_id) DO UPDATE SET
           ga4 = CASE WHEN ?5 = 1 THEN excluded.ga4 ELSE game_analytics.ga4 END,
           plausible = CASE WHEN ?6 = 1 THEN excluded.plausible ELSE game_analytics.plausible END,
           updated_at = excluded.updated_at`,
    )
      .bind(gameId, checked.value.ga4, checked.value.plausible, now, hasGa4, hasPlausible)
      .run();
    saved = await readGameAnalyticsConfig(env.DB, gameId);
  } catch (err) {
    return {
      status: 500,
      body: { error: err instanceof Error ? err.message : 'config write failed' },
    };
  }
  return { status: 200, body: { ok: true, config: saved } };
}
