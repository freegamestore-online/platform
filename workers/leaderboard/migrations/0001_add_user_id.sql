ALTER TABLE scores ADD COLUMN user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_user_scores ON scores(user_id, game_id, score DESC);
