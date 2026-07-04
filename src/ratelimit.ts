/** Per-user fixed-window rate limiter backed by the shared D1.
 *
 *  Protects endpoints that spend the SHARED platform GITHUB_TOKEN — the free
 *  GitHub-Models chat tier and /kidify — so one signed-in user can't loop a
 *  script and exhaust the quota (or the provisioning PAT's budget) for everyone.
 *  Fixed windows are coarse but cheap and adequate here. Fails OPEN on any DB
 *  error: a limiter outage must never take down the feature it guards. */

const SCHEMA = `CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL
)`;

let ready: Promise<unknown> | null = null;
function ensure(db: D1Database): Promise<unknown> {
  if (!ready) {
    ready = db
      .prepare(SCHEMA)
      .run()
      .catch((e) => {
        ready = null; // let a later call retry the DDL
        throw e;
      });
  }
  return ready;
}

/**
 * Count this hit against `key`'s current window and report whether it's within
 * `limit`. `nowSec` is injected for testability. Returns true (allow) on any
 * error.
 */
export async function allowRequest(
  db: D1Database,
  key: string,
  limit: number,
  windowSec: number,
  nowSec: number,
): Promise<boolean> {
  try {
    await ensure(db);
    const windowStart = Math.floor(nowSec / windowSec) * windowSec;
    const bucket = `${key}:${windowStart}`;
    const row = await db
      .prepare(
        `INSERT INTO rate_limits (bucket, count, window_start) VALUES (?, 1, ?)
         ON CONFLICT(bucket) DO UPDATE SET count = count + 1
         RETURNING count`,
      )
      .bind(bucket, windowStart)
      .first<{ count: number }>();
    const count = row?.count ?? 1;
    // On the first hit of a new window, prune this key's stale buckets so the
    // table stays bounded (~1 row per active key). Best-effort.
    if (count === 1) {
      db.prepare("DELETE FROM rate_limits WHERE bucket LIKE ? AND window_start < ?")
        .bind(`${key}:%`, windowStart)
        .run()
        .catch(() => {});
    }
    return count <= limit;
  } catch {
    return true; // fail open
  }
}
