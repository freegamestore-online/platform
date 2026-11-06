-- Keyless game deploys (#488, #438): apps/admin/src/deploy.ts.
--
-- game_repositories pins each game to one GitHub repository by its immutable
-- repository_id, so a renamed, deleted-and-recreated or reused repo name can
-- never deploy to the game. UNIQUE(repository_id) maps a repo to exactly one game.
CREATE TABLE IF NOT EXISTS game_repositories (
  game_id       TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL UNIQUE,
  repository    TEXT NOT NULL,
  pinned_at     INTEGER NOT NULL
);

-- One row per deploy session. jti is UNIQUE so an OIDC token opens one session
-- at most (replay protection); token_hash is the SHA-256 of the upload token.
-- status: open -> live -> superseded -> deleted (or open past expires_at).
CREATE TABLE IF NOT EXISTS game_deploys (
  id            TEXT PRIMARY KEY,
  game_id       TEXT NOT NULL,
  jti           TEXT NOT NULL UNIQUE,
  repository_id TEXT NOT NULL,
  sha           TEXT,
  run_id        TEXT,
  token_hash    TEXT NOT NULL,
  manifest      TEXT NOT NULL,
  total_bytes   INTEGER NOT NULL,
  status        TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  committed_at  INTEGER
);
CREATE INDEX IF NOT EXISTS game_deploys_game_created ON game_deploys (game_id, created_at);
