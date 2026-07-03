-- VibeCode agent sessions: projects + chat messages persisted in D1.
-- Shared by the publisher UI, MCP history tools, and the agent worker.

CREATE TABLE IF NOT EXISTS agent_sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'New Game',
  app_id TEXT,
  app_url TEXT,
  deployed INTEGER NOT NULL DEFAULT 0,
  messages TEXT,
  deploy_state TEXT,
  deploy_log TEXT,
  errors TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_user ON agent_sessions (user_id, updated_at DESC);
