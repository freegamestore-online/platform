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
