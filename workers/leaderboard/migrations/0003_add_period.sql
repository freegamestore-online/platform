-- Per-day boards (#161). A score with a period belongs to that day's board;
-- NULL is the all-time board, which is every row (the pre-period behaviour).
ALTER TABLE scores ADD COLUMN period TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_game_period ON scores(game_id, period);
