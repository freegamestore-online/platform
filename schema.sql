CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,
  player_name TEXT NOT NULL DEFAULT 'Anonymous',
  score INTEGER NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_game_score ON scores(game_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_game_recent ON scores(game_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rate_limit ON scores(ip_hash, game_id, created_at DESC);
