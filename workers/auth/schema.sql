CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now'))
);

-- jti of every redeemed handoff, so /handoff/consume is single-use (#464).
-- The worker creates this itself on first use and prunes rows past `exp`.
CREATE TABLE IF NOT EXISTS handoff_consumed (
  jti TEXT PRIMARY KEY,
  exp INTEGER NOT NULL
);

-- Account-deletion watermark (#499): tokens for `sub` issued at or before
-- revoked_at_ms (epoch milliseconds) are refused. Kept apart from `users`
-- because deletion removes that row and a new sign-in recreates it.
-- The worker creates this itself on first use.
CREATE TABLE IF NOT EXISTS session_revocations (
  sub TEXT PRIMARY KEY,
  revoked_at_ms INTEGER NOT NULL
);

-- Creates by the create canary (#531), per UTC day, capped in the worker.
-- The worker creates this itself on first use.
CREATE TABLE IF NOT EXISTS canary_creates (
  day TEXT PRIMARY KEY,
  n INTEGER NOT NULL
);
