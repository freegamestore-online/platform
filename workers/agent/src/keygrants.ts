/**
 * Complimentary access grants — an admin gives SELECT users free builds on a
 * PLATFORM-funded provider key.
 *
 * Unlike the BYO vault (keys.ts), NO user secret is stored: a grant is just a
 * row saying "user X may build on the platform's <provider> key using <model>."
 * The actual key is a worker secret (`COMP_KEY_<PROVIDER>`), so it rotates in
 * one place, is never typed into or stored by the admin UI, and a grant is
 * revoked by deleting one row. One grant per user (a user gets one comp
 * provider/model); re-granting overwrites.
 */
import type { Env } from "./index";

// Only providers the agent's createAdapter (agent.ts) can actually run — a comp
// grant must resolve to a working turn. openrouter is intentionally excluded
// (no adapter case for it), so we never fund a provider that throws at runtime.
export const COMP_PROVIDERS = new Set(["github", "anthropic", "openai", "google"]);

const SCHEMA = `CREATE TABLE IF NOT EXISTS complimentary_grants (
  user_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  granted_by TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT
)`;

let schemaReady = false;
async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaReady) return;
  await db.prepare(SCHEMA).run();
  schemaReady = true;
}

export interface Grant {
  userId: string;
  provider: string;
  model: string;
  grantedBy: string;
  note: string | null;
  createdAt: string;
  expiresAt: string | null;
}

/** The platform key funding a provider, or null if none is configured. Reads
 *  the `COMP_KEY_<PROVIDER>` worker secret (e.g. COMP_KEY_ANTHROPIC). */
export function compKeyFor(env: Env, provider: string): string | null {
  const name = `COMP_KEY_${provider.toUpperCase()}`;
  const val = (env as unknown as Record<string, unknown>)[name];
  return typeof val === "string" && val.trim() ? val.trim() : null;
}

function rowToGrant(r: Record<string, unknown>): Grant {
  return {
    userId: String(r.user_id),
    provider: String(r.provider),
    model: String(r.model),
    grantedBy: String(r.granted_by),
    note: r.note ? String(r.note) : null,
    createdAt: String(r.created_at),
    expiresAt: r.expires_at ? String(r.expires_at) : null,
  };
}

/** Upsert a complimentary grant for a user. */
export async function grantComp(
  env: Env,
  opts: { userId: string; provider: string; model: string; grantedBy: string; note?: string | null; expiresAt?: string | null },
): Promise<void> {
  await ensureSchema(env.DB);
  await env.DB.prepare(
    `INSERT INTO complimentary_grants (user_id, provider, model, granted_by, note, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'), ?)
     ON CONFLICT(user_id) DO UPDATE SET
       provider = excluded.provider,
       model = excluded.model,
       granted_by = excluded.granted_by,
       note = excluded.note,
       expires_at = excluded.expires_at`,
  )
    .bind(opts.userId, opts.provider, opts.model, opts.grantedBy, opts.note ?? null, opts.expiresAt ?? null)
    .run();
}

export async function revokeComp(env: Env, userId: string): Promise<void> {
  await ensureSchema(env.DB);
  await env.DB.prepare("DELETE FROM complimentary_grants WHERE user_id = ?").bind(userId).run();
}

/** All grants (for the admin panel). */
export async function listComp(env: Env): Promise<Grant[]> {
  await ensureSchema(env.DB);
  const { results } = await env.DB.prepare(
    "SELECT user_id, provider, model, granted_by, note, created_at, expires_at FROM complimentary_grants ORDER BY created_at DESC",
  ).all();
  return (results as Record<string, unknown>[]).map(rowToGrant);
}

/** A user's ACTIVE grant, or null if none / expired. Expired grants are treated
 *  as absent (and lazily pruned) so a lapsed grant silently stops funding. */
export async function getActiveComp(env: Env, userId: string): Promise<Grant | null> {
  if (!userId) return null;
  await ensureSchema(env.DB);
  const row = await env.DB.prepare(
    "SELECT user_id, provider, model, granted_by, note, created_at, expires_at FROM complimentary_grants WHERE user_id = ?",
  )
    .bind(userId)
    .first<Record<string, unknown>>();
  if (!row) return null;
  const grant = rowToGrant(row);
  if (grant.expiresAt && Date.parse(grant.expiresAt) <= Date.now()) {
    // Lazily prune the lapsed grant; never block resolution on it.
    revokeComp(env, userId).catch(() => {});
    return null;
  }
  return grant;
}
