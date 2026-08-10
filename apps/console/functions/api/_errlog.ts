/** Durable error/crash logging → the shared `error_log` D1 table (admin's "fas"
 *  DB), surfaced on the admin console. Always console.error()s too, so the entry
 *  lands in Workers Logs even if the D1 write itself fails. Best-effort: logging
 *  must never throw into the caller's path. */

export interface ErrLogRow {
  source: string; // e.g. "api/create"
  user?: string | null; // github login, if known
  context?: string | null; // free-form (step, timing, ids)
  message: string;
  stack?: string | null;
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
  if (!ready) ready = db.prepare(SCHEMA).run().catch((e) => { ready = null; throw e; });
  return ready;
}

export async function recordError(db: D1Database | undefined, row: ErrLogRow): Promise<void> {
  console.error(
    `[error] source=${row.source} ctx=${row.context ?? ""} user=${row.user ?? "?"} :: ${row.message}` +
      (row.stack ? `\n${row.stack}` : ""),
  );
  if (!db) return;
  try {
    await ensure(db);
    await db
      .prepare("INSERT INTO error_log (source, user_github, context, message, stack) VALUES (?, ?, ?, ?, ?)")
      .bind(
        row.source,
        row.user ?? null,
        row.context ?? null,
        row.message.slice(0, 2000),
        (row.stack ?? "").slice(0, 4000) || null,
      )
      .run();
  } catch (e) {
    console.error(`[error] failed to persist error_log: ${String(e)}`);
  }
}

/** fetch() with an abort timeout. On timeout it throws a labelled error so a
 *  hung upstream becomes a VISIBLE, logged failure instead of the whole Pages
 *  Function being killed mid-request (which reaches the browser as an opaque
 *  "Load failed"). Timeout is generous — it only trips a true hang, never a
 *  slow-but-working call. Pure instrumentation; the request semantics are
 *  otherwise unchanged. */
export async function fetchWithTimeout(url: string, init: RequestInit, ms: number, label: string): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error(`${label} timed out after ${ms}ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
