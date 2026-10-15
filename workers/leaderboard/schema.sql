CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,
  player_name TEXT NOT NULL DEFAULT 'Anonymous',
  score INTEGER NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  user_id TEXT,
  period TEXT DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_game_score ON scores(game_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_game_recent ON scores(game_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rate_limit ON scores(ip_hash, game_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_scores ON scores(user_id, game_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_game_period ON scores(game_id, period);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now'))
);
