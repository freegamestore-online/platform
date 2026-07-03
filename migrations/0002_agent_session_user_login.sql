ALTER TABLE agent_sessions ADD COLUMN user_login TEXT;

CREATE INDEX IF NOT EXISTS idx_agent_sessions_login ON agent_sessions (user_login, updated_at DESC);
