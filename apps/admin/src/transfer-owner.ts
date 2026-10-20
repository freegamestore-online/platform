// Admin compare-and-set game ownership transfer (#358). Ported from
// FreeAppStore's transfer-owner (freeappstore-online/platform#274).
//
// FGS records a game's owner as `creatorGithub` on its registry.json entry, not
// in a D1 row, so the compare-and-set runs inside mutateRegistry: the owner
// check is applied to the registry it read, and the write is a GitHub contents
// PUT against that read's sha. A concurrent writer makes the PUT fail with 409;
// mutateRegistry then re-reads and re-runs the check, so a transfer never
// lands on an owner it did not see.
//
// The audit trail is in two places. The registry commit message records who,
// from, to and why, and is written in the same commit as the change. After the
// commit, a row goes into the `game_owner_transfers` D1 table so admins can
// query it. That row can't be in the same transaction as a GitHub commit, so a
// failed insert is reported in the response (`audit_id: null`) rather than
// undoing a transfer that already happened.
//
// Registry only: repo collaborator access on GitHub is not changed here.

import { ghApi, mutateRegistry, type PublishEnv } from './publish';

/** Shape check only. Whether the game exists is decided by the registry. */
export const GAME_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
/** GitHub login: 1–39 of [A-Za-z0-9-], not starting or ending with a hyphen. */
const LOGIN_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;
const REASON_MAX = 500;

export interface TransferInput {
  game_id: string;
  from_login: string;
  to_login: string;
  reason: string;
}

export interface TransferAudit {
  id: number;
  game_id: string;
  from_login: string;
  to_login: string;
  reason: string;
  actor: string;
  created_at: number;
}

export type TransferOutcome =
  | {
      status: 200;
      body: {
        ok: true;
        game_id: string;
        from_login: string;
        to_login: string;
        owner_login: string;
        audit_id: number | null;
        audit_error?: string;
      };
    }
  | { status: 400; body: { error: string; login?: string } }
  | { status: 404; body: { error: string; game_id: string } }
  | { status: 409; body: { error: string; game_id: string; owner_login: string | null } }
  | { status: 502; body: { error: string } };

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function parseTransferBody(
  body: unknown,
): { ok: true; value: TransferInput } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'expected a JSON object' };
  }
  const raw = body as Record<string, unknown>;
  const game_id = text(raw.game_id);
  const from_login = text(raw.from_login);
  const to_login = text(raw.to_login);
  const reason = text(raw.reason);
  if (!game_id) return { ok: false, error: 'game_id is required' };
  if (!GAME_ID_RE.test(game_id)) return { ok: false, error: 'invalid game id' };
  if (!from_login) return { ok: false, error: 'from_login is required' };
  if (!LOGIN_RE.test(from_login)) return { ok: false, error: 'invalid from_login' };
  if (!to_login) return { ok: false, error: 'to_login is required' };
  if (!LOGIN_RE.test(to_login)) return { ok: false, error: 'invalid to_login' };
  if (!reason) return { ok: false, error: 'reason is required' };
  if (reason.length > REASON_MAX) return { ok: false, error: 'reason is too long' };
  return { ok: true, value: { game_id, from_login, to_login, reason } };
}

/** Same table as workers/host/migrations/0003_create_game_owner_transfers.sql.
 *  Created here too so an admin deploy that lands before the migration is
 *  applied still records its audit rows (errlog does the same). */
async function ensureTransfersTable(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS game_owner_transfers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id TEXT NOT NULL,
        from_login TEXT NOT NULL,
        to_login TEXT NOT NULL,
        reason TEXT NOT NULL,
        actor TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
    )
    .run();
  await db
    .prepare(
      'CREATE INDEX IF NOT EXISTS game_owner_transfers_game_idx ON game_owner_transfers (game_id, id)',
    )
    .run();
}

/** GitHub's canonical casing for `login`, null when no such account exists,
 *  or undefined when GitHub could not be asked. */
async function canonicalLogin(env: PublishEnv, login: string): Promise<string | null | undefined> {
  const user = await ghApi(env, `/users/${encodeURIComponent(login)}`);
  if (user.__status === 404) return null;
  if (user.__status !== 200 || typeof user.login !== 'string') return undefined;
  return user.login as string;
}

/**
 * Move a game's `creatorGithub` from `from_login` to `to_login`.
 *
 * Refused with 409 and the actual owner unless the recorded owner equals
 * `from_login` (case-insensitive, as GitHub logins are). `from_login` is
 * checked against the registry, not GitHub: naming the recorded owner is the
 * proof required, even if that account has since been deleted. `to_login` must
 * be a real GitHub account. Undo is the same call with the logins swapped.
 *
 * `actor` is the admin's verified email; it goes into the audit record.
 */
export async function transferGameOwner(
  env: PublishEnv,
  input: TransferInput,
  actor: string,
): Promise<TransferOutcome> {
  const toLogin = await canonicalLogin(env, input.to_login);
  if (toLogin === undefined) return { status: 502, body: { error: 'could not verify to_login' } };
  if (toLogin === null)
    return { status: 400, body: { error: 'unknown login', login: input.to_login } };

  let previous = '';
  const message =
    `Transfer ${input.game_id} owner from ${input.from_login} to ${toLogin}\n\n` +
    `Admin: ${actor}\nReason: ${input.reason}\nRefs #358`;
  const result = await mutateRegistry<undefined>(env, message, (items) => {
    const game = items.find((g) => g.id === input.game_id);
    if (!game) return { ok: false, error: 'unknown game', code: 'not_found' };
    const owner = typeof game.creatorGithub === 'string' ? game.creatorGithub : '';
    // The compare-and-set. An ownerless game is a mismatch too: there is no
    // recorded owner for `from_login` to name.
    if (!owner || !same(owner, input.from_login)) {
      return { ok: false, error: `owner:${owner}`, code: 'conflict' };
    }
    if (same(owner, toLogin)) return { ok: false, error: 'already', code: 'invalid' };
    previous = owner;
    game.creatorGithub = toLogin;
    // `developer` is the display credit and defaults to the creator. Move it
    // with the owner only when it still shows the old owner.
    if (typeof game.developer === 'string' && same(game.developer, owner)) {
      game.developer = toLogin;
    }
    return { ok: true, value: undefined };
  });

  if (!result.ok) {
    if (result.code === 'not_found') {
      return { status: 404, body: { error: 'unknown game', game_id: input.game_id } };
    }
    if (result.code === 'invalid' && result.error === 'already') {
      return {
        status: 400,
        body: { error: 'game is already owned by this login', login: toLogin },
      };
    }
    if (result.code === 'conflict' && result.error.startsWith('owner:')) {
      const owner = result.error.slice('owner:'.length);
      return {
        status: 409,
        body: { error: 'owner mismatch', game_id: input.game_id, owner_login: owner || null },
      };
    }
    return { status: 502, body: { error: result.error || 'registry update failed' } };
  }

  let auditId: number | null = null;
  let auditError: string | undefined;
  try {
    await ensureTransfersTable(env.DB);
    const inserted = await env.DB.prepare(
      `INSERT INTO game_owner_transfers (game_id, from_login, to_login, reason, actor, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
      .bind(input.game_id, previous, toLogin, input.reason, actor, Date.now())
      .run();
    auditId = Number(inserted?.meta?.last_row_id ?? 0) || null;
  } catch (err) {
    // The transfer is committed; its registry commit message still holds the
    // full record. Say so rather than pretend the transfer failed.
    auditError = `audit row not written: ${String(err)}`;
    console.error(`[transfer-owner] ${input.game_id}: ${auditError}`);
  }

  return {
    status: 200,
    body: {
      ok: true,
      game_id: input.game_id,
      from_login: previous,
      to_login: toLogin,
      owner_login: toLogin,
      audit_id: auditId,
      ...(auditError ? { audit_error: auditError } : {}),
    },
  };
}

/** Newest first, at most 50. Empty when nothing has been transferred yet. */
export async function listOwnerTransfers(db: D1Database, gameId: string): Promise<TransferAudit[]> {
  await ensureTransfersTable(db);
  const res = await db
    .prepare(
      `SELECT id, game_id, from_login, to_login, reason, actor, created_at
       FROM game_owner_transfers
       WHERE game_id = ?1
       ORDER BY id DESC
       LIMIT 50`,
    )
    .bind(gameId)
    .all<TransferAudit>();
  return res.results ?? [];
}
