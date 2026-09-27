/**
 * Versioned, runtime-neutral contract for the platform-wide `error_log` D1
 * table. This module deliberately has no Cloudflare runtime imports so the
 * admin Worker, console Pages Functions, and agent Worker can bundle it.
 */

export const ERROR_LOG_SCHEMA = `CREATE TABLE IF NOT EXISTS error_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT NOT NULL,
  user_github TEXT,
  context TEXT,
  message TEXT NOT NULL,
  stack TEXT
)`;

/** Maximum stored/requested characters for every accepted error-log field. */
export const ERROR_LOG_LIMITS = {
  source: 200,
  user: 200,
  context: 1_000,
  message: 2_000,
  stack: 4_000,
  route: 200,
} as const;

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

export type ErrorLogInput = Partial<Record<keyof ErrLogRow, unknown>>;

type D1StatementLike = {
  bind(...values: unknown[]): D1StatementLike;
  run(): Promise<unknown>;
};

type D1DatabaseLike = {
  prepare(query: string): D1StatementLike;
};

function requiredText(value: unknown, limit: number): string | null {
  return typeof value === 'string' && value.trim() ? value.slice(0, limit) : null;
}

/** Clamp a client-only metadata value using the same versioned limits. */
export function clampErrorLogText(value: string, limit: number): string {
  return value.slice(0, limit);
}

/**
 * The sole row-validation and field-clamping rule. Empty optional strings are
 * stored as NULL; source and message must be non-blank strings.
 */
export function normalizeErrorLogRow(input: ErrorLogInput): ErrLogRow | null {
  const source = requiredText(input.source, ERROR_LOG_LIMITS.source);
  const message = requiredText(input.message, ERROR_LOG_LIMITS.message);
  if (!source || !message) return null;

  const optional = (value: unknown, limit: number) =>
    typeof value === 'string' && value ? value.slice(0, limit) : null;

  return {
    source,
    user: optional(input.user, ERROR_LOG_LIMITS.user),
    context: optional(input.context, ERROR_LOG_LIMITS.context),
    message,
    stack: optional(input.stack, ERROR_LOG_LIMITS.stack),
  };
}

const readyByDatabase = new WeakMap<object, Promise<unknown>>();

/** Lazily create the table once per bound D1 database in this isolate. */
export function ensureErrorLogTable(db: D1DatabaseLike): Promise<unknown> {
  const cached = readyByDatabase.get(db);
  if (cached) return cached;
  const ready = db
    .prepare(ERROR_LOG_SCHEMA)
    .run()
    .catch((error) => {
      readyByDatabase.delete(db);
      throw error;
    });
  readyByDatabase.set(db, ready);
  return ready;
}

/**
 * Best-effort durable persistence shared by the admin Worker and console Pages
 * Functions. Logging is also emitted to Workers Logs and never throws back to
 * its caller.
 */
export async function recordError(
  db: D1DatabaseLike | undefined,
  input: ErrorLogInput,
): Promise<void> {
  const row = normalizeErrorLogRow(input);
  if (!row) return;
  console.error(
    `[error] source=${row.source} ctx=${row.context ?? ''} user=${row.user ?? '?'} :: ${row.message}` +
      (row.stack ? `\n${row.stack}` : ''),
  );
  if (!db) return;
  try {
    await ensureErrorLogTable(db);
    await db
      .prepare(
        'INSERT INTO error_log (source, user_github, context, message, stack) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(row.source, row.user ?? null, row.context ?? null, row.message, row.stack ?? null)
      .run();
  } catch (error) {
    console.error(`[error] failed to persist error_log: ${String(error)}`);
  }
}
