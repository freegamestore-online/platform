// Revocation of admin CLI sessions (#500). Those sessions are signed by this
// worker, so the auth worker's account-deletion watermark (#499) cannot cover
// them. Account deletion (console /auth/delete) calls DELETE /v1/auth/sessions,
// which records a per-subject watermark here; verifySession then refuses any
// session issued at or before it. There is deliberately no endpoint that
// answers "was this id deleted?" - the only reader is verifySession.

/** Same table as workers/host/migrations/0006_admin_session_revocations.sql,
 *  created here too so an admin deploy that lands first still works. */
const DDL =
  'CREATE TABLE IF NOT EXISTS admin_session_revocations (subject TEXT PRIMARY KEY, revoked_at INTEGER NOT NULL)';

let ensured = false;
async function ensureTable(db: D1Database): Promise<void> {
  if (ensured) return;
  await db.prepare(DDL).run();
  ensured = true;
}

/** The watermark keys that apply to a session: its GitHub id when it has one,
 *  else (sessions minted before #472) its login, which GitHub lowercases for
 *  comparison purposes. */
function subjectsFor(login: string, githubId: string | null): string[] {
  return githubId ? [`gid:${githubId}`] : [`login:${login.toLowerCase()}`];
}

/** Revoke every session issued so far for this identity. Writes both keys, so
 *  sessions with and without a `gid` are covered. Idempotent. */
export async function revokeSessions(
  db: D1Database,
  who: { login: string; githubId: string | null },
): Promise<void> {
  await ensureTable(db);
  const now = Math.floor(Date.now() / 1000);
  const subjects = [
    ...subjectsFor(who.login, null),
    ...(who.githubId ? subjectsFor(who.login, who.githubId) : []),
  ];
  await db.batch(
    subjects.map((subject) =>
      db
        .prepare(
          `INSERT INTO admin_session_revocations (subject, revoked_at) VALUES (?, ?)
           ON CONFLICT(subject) DO UPDATE SET revoked_at = MAX(revoked_at, excluded.revoked_at)`,
        )
        .bind(subject, now),
    ),
  );
}

/** True when the session was issued at or before its subject's watermark. `iat`
 *  is whole seconds, so one minted in the second of the deletion is refused
 *  too; a session with no usable `iat` cannot be placed after it either. */
export async function isRevoked(
  db: D1Database,
  who: { login: string; githubId: string | null },
  iat: unknown,
): Promise<boolean> {
  await ensureTable(db);
  const [subject] = subjectsFor(who.login, who.githubId);
  const row = await db
    .prepare('SELECT revoked_at FROM admin_session_revocations WHERE subject = ?')
    .bind(subject)
    .first<{ revoked_at: number }>();
  if (!row) return false;
  return typeof iat !== 'number' || iat <= row.revoked_at;
}
