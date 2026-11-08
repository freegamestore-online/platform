-- Revocation watermarks for admin CLI sessions (#500).
--
-- `fgs login` sessions are signed by the admin worker itself, so the auth
-- worker's deletion watermark (#499) never sees them. When the console deletes
-- an account it asks admin to record one here, and apps/admin/src/session-
-- revocations.ts refuses any session issued at or before it. Written and read
-- only by the admin worker, which shares this database; it also creates the
-- table if missing, so the order of this migration and an admin deploy does not
-- matter.
--
-- subject: `gid:<numeric GitHub id>`, or `login:<lowercased login>` for the
-- sessions minted before #472 that carry no id. revoked_at: unix seconds.

CREATE TABLE IF NOT EXISTS admin_session_revocations (
  subject    TEXT PRIMARY KEY,
  revoked_at INTEGER NOT NULL
);
