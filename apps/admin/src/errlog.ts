/** Read/query helpers for the shared error-log persistence contract. */
import { ensureErrorLogTable } from '../../../contracts/error-log/v1/contract';

export {
  type ErrLogEntry,
  type ErrLogRow,
  recordError,
} from '../../../contracts/error-log/v1/contract';

import type { ErrLogEntry } from '../../../contracts/error-log/v1/contract';
import type { RegistryGame } from './registryReader';

export interface ListErrorsOpts {
  user?: string;
  source?: string;
}

export async function listErrors(
  db: D1Database | undefined,
  limit = 200,
  opts: ListErrorsOpts = {},
): Promise<ErrLogEntry[]> {
  if (!db) return [];
  try {
    await ensureErrorLogTable(db);
    const clauses: string[] = [];
    const bindings: unknown[] = [];
    if (opts.user) {
      clauses.push('user_github = ?');
      bindings.push(opts.user);
    }
    if (opts.source) {
      clauses.push('source = ?');
      bindings.push(opts.source);
    }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    bindings.push(Math.min(limit, 500));
    const r = await db
      .prepare(
        `SELECT id, ts, source, user_github, context, message, stack FROM error_log${where} ORDER BY id DESC LIMIT ?`,
      )
      .bind(...bindings)
      .all<ErrLogEntry>();
    return r.results ?? [];
  } catch {
    return [];
  }
}

/** Retention prune: drop error_log rows older than `days` (default 30). Called
 *  from the hourly cron so the table can't grow unbounded. Best-effort — a prune
 *  failure must never throw into the scheduled handler. */
export async function pruneErrors(db: D1Database | undefined, days = 30): Promise<void> {
  if (!db) return;
  try {
    await ensureErrorLogTable(db);
    await db
      .prepare(`DELETE FROM error_log WHERE ts < datetime('now', ?)`)
      .bind(`-${days} days`)
      .run();
  } catch (e) {
    console.error(`[error] failed to prune error_log: ${String(e)}`);
  }
}

export interface ErrorStats {
  total: number;
  last24h: number;
  series: { d: string; c: number }[]; // per-day counts, last 14 days
}

export interface AdminOverviewStats {
  games: number;
  creators: number;
  errors24h: number;
  errorsTotal: number;
  errorSeries: { d: string; c: number }[];
}

/** Keep the worker response aligned with the admin web's overview contract. */
export function buildAdminOverviewStats(
  errors: ErrorStats,
  registry: RegistryGame[] | null,
): AdminOverviewStats {
  const games = registry ?? [];
  const creators = new Set(
    games
      .map((game) => game.creatorGithub)
      .filter((login): login is string => typeof login === 'string' && login.length > 0)
      .map((login) => login.toLowerCase()),
  );
  return {
    games: games.length,
    creators: creators.size,
    errors24h: errors.last24h,
    errorsTotal: errors.total,
    errorSeries: errors.series,
  };
}

export async function errorStats(db: D1Database | undefined): Promise<ErrorStats> {
  if (!db) return { total: 0, last24h: 0, series: [] };
  try {
    await ensureErrorLogTable(db);
    const total = await db.prepare('SELECT COUNT(*) AS c FROM error_log').first<{ c: number }>();
    const day = await db
      .prepare("SELECT COUNT(*) AS c FROM error_log WHERE ts >= datetime('now','-1 day')")
      .first<{ c: number }>();
    const series = await db
      .prepare(
        "SELECT substr(ts,1,10) AS d, COUNT(*) AS c FROM error_log WHERE ts >= datetime('now','-14 day') GROUP BY d ORDER BY d",
      )
      .all<{ d: string; c: number }>();
    return { total: total?.c ?? 0, last24h: day?.c ?? 0, series: series.results ?? [] };
  } catch {
    return { total: 0, last24h: 0, series: [] };
  }
}
