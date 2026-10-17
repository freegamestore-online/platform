-- Per-game analytics config (#350). One row per game that opts into analytics.
--
-- The loader at api.freegamestore.online/v1/analytics.js reads this row to build
-- the game's tag set. Every column is optional; a NULL means "not configured".
--
--   cf_beacon_token  Cloudflare Web Analytics token (32+ hex chars) for this game.
--                    When NULL the store-wide CF_BEACON_TOKEN is used, if set.
--   ga4              Google Analytics 4 measurement id, "G-XXXXXXXX".
--   plausible        Plausible site domain, e.g. "2048.freegamestore.online".
--   custom_head      Raw HTML injected into <head>, capped at 4096 chars by the
--                    loader. Owner-supplied, so it runs as the game's own script.
--
-- Page views and custom events are not stored here. They go to the
-- fgs_game_analytics Analytics Engine dataset (see wrangler.toml).

CREATE TABLE IF NOT EXISTS game_analytics (
  game_id TEXT PRIMARY KEY,
  cf_beacon_token TEXT,
  ga4 TEXT,
  plausible TEXT,
  custom_head TEXT,
  updated_at INTEGER NOT NULL
);
