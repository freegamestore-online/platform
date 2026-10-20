-- Audit trail for admin game-ownership transfers (#358). Mirrors FreeAppStore's
-- app_owner_transfers (freeappstore-online/platform#274).
--
-- Written by the admin worker (apps/admin/src/transfer-owner.ts), which shares
-- this database. One row per successful compare-and-set: from_login is the
-- owner recorded at the moment of the transfer, actor is the admin's verified
-- email. The admin worker also creates this table if it is missing, so the
-- order of this migration and an admin deploy does not matter.

CREATE TABLE IF NOT EXISTS game_owner_transfers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id     TEXT NOT NULL,
  from_login  TEXT NOT NULL,
  to_login    TEXT NOT NULL,
  reason      TEXT NOT NULL,
  actor       TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS game_owner_transfers_game_idx ON game_owner_transfers (game_id, id);
