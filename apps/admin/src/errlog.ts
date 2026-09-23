/** Durable error/crash log in the shared "fas" D1 (`error_log`). The publisher's
 *  /api/create writes to the SAME table (its own _errlog.ts), so the admin
 *  console shows crashes from both the create Pages Function and admin's own
 *  provision path. Read helpers back the console's Errors tab. Best-effort:
 *  logging must never throw into the caller. */

export interface ErrLogRow {
  source: string;
  user?: string | null;
  context?: string | null;
  message: string;
  stack?: string | null;
}

export interface ErrLogEntry extends ErrLogRow {
  id: number;
  ts: string;
  user_github: string | null;
}

const SCHEMA = `CREATE TABLE IF NOT EXISTS error_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT NOT NULL,
  user_github TEXT,
  context TEXT,
  message TEXT NOT NULL,
  stack TEXT
)`;

let ready: Promise<unknown> | null = null;
function ensure(db: D1Database): Promise<unknown> {
  if (!ready)
    ready = db
      .prepare(SCHEMA)
      .run()
      .catch((e) => {
        ready = null;
        throw e;
      });
  return ready;
}

export async function recordError(db: D1Database | undefined, row: ErrLogRow): Promise<void> {
  console.error(
    `[error] source=${row.source} ctx=${row.context ?? ''} user=${row.user ?? '?'} :: ${row.message}`,
  );
  if (!db) return;
  try {
    await ensure(db);
    await db
      .prepare(
        'INSERT INTO error_log (source, user_github, context, message, stack) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(
        row.source,
        row.user ?? null,
        row.context ?? null,
        row.message.slice(0, 2000),
        (row.stack ?? '').slice(0, 4000) || null,
      )
      .run();
  } catch (e) {
    console.error(`[error] failed to persist error_log: ${String(e)}`);
  }
}

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
    await ensure(db);
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
    await ensure(db);
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

export async function errorStats(db: D1Database | undefined): Promise<ErrorStats> {
  if (!db) return { total: 0, last24h: 0, series: [] };
  try {
    await ensure(db);
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
