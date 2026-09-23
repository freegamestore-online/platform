/**
 * User AI-provider key vault (BYO keys), backed by D1.
 *
 * Keys are stored ENCRYPTED (envelope AES-256-GCM, see crypto.ts) and the
 * plaintext is only ever decrypted server-side inside this Worker to call the
 * provider. There is deliberately NO endpoint that returns a stored key to a
 * client — status/list expose metadata only. This replaces the old
 * localStorage-on-the-console model, where an XSS on the console could read the
 * raw keys.
 */

import { openSecret, sealSecret } from "./crypto";
import type { Env } from "./index";
import { resolveUser } from "./sessions";

const VALID_PROVIDERS = new Set(["github", "openrouter", "anthropic", "openai", "google"]);
const KEK_VERSION = 1;

const SCHEMA = `CREATE TABLE IF NOT EXISTS user_api_keys (
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  key_ciphertext BLOB NOT NULL,
  dek_wrapped BLOB NOT NULL,
  iv BLOB NOT NULL,
  kek_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  PRIMARY KEY (user_id, provider)
)`;

let schemaReady = false;
async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaReady) return;
  await db.prepare(SCHEMA).run();
  schemaReady = true;
}

function toBuf(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}
function toU8(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (Array.isArray(v)) return new Uint8Array(v as number[]);
  return new Uint8Array();
}

export function isValidProvider(provider: string): boolean {
  return VALID_PROVIDERS.has(provider);
}

/** Encrypt + upsert a user's provider key. */
export async function saveUserKey(env: Env, userId: string, provider: string, plaintext: string): Promise<void> {
  if (!env.AI_KEYS_KEK) throw new Error("AI_KEYS_KEK not configured");
  await ensureSchema(env.DB);
  const sealed = await sealSecret(plaintext, env.AI_KEYS_KEK);
  await env.DB.prepare(
    `INSERT INTO user_api_keys (user_id, provider, key_ciphertext, dek_wrapped, iv, kek_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(user_id, provider) DO UPDATE SET
       key_ciphertext = excluded.key_ciphertext,
       dek_wrapped = excluded.dek_wrapped,
       iv = excluded.iv,
       kek_version = excluded.kek_version,
       updated_at = datetime('now')`,
  )
    .bind(userId, provider, toBuf(sealed.keyCiphertext), toBuf(sealed.dekWrapped), toBuf(sealed.iv), KEK_VERSION)
    .run();
}

export async function deleteUserKey(env: Env, userId: string, provider: string): Promise<void> {
  await ensureSchema(env.DB);
  await env.DB.prepare("DELETE FROM user_api_keys WHERE user_id = ? AND provider = ?").bind(userId, provider).run();
}

/** Providers the user has a key for — metadata only, never the key itself. */
export async function keyStatus(
  env: Env,
  userId: string,
): Promise<Array<{ provider: string; updatedAt: string; lastUsedAt: string | null }>> {
  await ensureSchema(env.DB);
  const { results } = await env.DB.prepare("SELECT provider, updated_at, last_used_at FROM user_api_keys WHERE user_id = ?")
    .bind(userId)
    .all();
  return (results as Record<string, unknown>[]).map((r) => ({
    provider: String(r.provider),
    updatedAt: String(r.updated_at),
    lastUsedAt: r.last_used_at ? String(r.last_used_at) : null,
  }));
}

/** Decrypt a user's provider key SERVER-SIDE (chat handler only). Returns null
 *  if there's no key or the vault isn't configured. Never exposed over HTTP. */
export async function resolveUserKey(env: Env, userId: string, provider: string): Promise<string | null> {
  if (!env.AI_KEYS_KEK || !env.DB) return null;
  await ensureSchema(env.DB);
  const row = await env.DB.prepare("SELECT key_ciphertext, dek_wrapped, iv FROM user_api_keys WHERE user_id = ? AND provider = ?")
    .bind(userId, provider)
    .first<{ key_ciphertext: unknown; dek_wrapped: unknown; iv: unknown }>();
  if (!row) return null;
  try {
    const plaintext = await openSecret(
      { keyCiphertext: toU8(row.key_ciphertext), dekWrapped: toU8(row.dek_wrapped), iv: toU8(row.iv) },
      env.AI_KEYS_KEK,
    );
    // Best-effort usage stamp; never block the request on it.
    env.DB.prepare("UPDATE user_api_keys SET last_used_at = datetime('now') WHERE user_id = ? AND provider = ?")
      .bind(userId, provider)
      .run()
      .catch(() => {});
    return plaintext;
  } catch {
    return null;
  }
}

/**
 * Handle `/v1/keys/status` (GET) and `/v1/keys/:provider` (PUT save / DELETE
 * remove). Returns null when the path is not a keys route so the caller can fall
 * through. There is intentionally no route that returns a stored key.
 */
export async function handleKeysApi(request: Request, env: Env, cors: Record<string, string>): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path !== "/v1/keys/status" && !path.startsWith("/v1/keys/")) return null;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });

  if (!env.DB) return json({ error: "database not configured" }, 500);
  const user = await resolveUser(request, env.AUTH);
  if (!user) return json({ error: "unauthorized" }, 401);

  if (path === "/v1/keys/status" && request.method === "GET") {
    return json({ providers: await keyStatus(env, user.id) });
  }

  const m = path.match(/^\/v1\/keys\/([a-z0-9-]{1,32})$/);
  if (m) {
    const provider = m[1]!;
    if (!isValidProvider(provider)) return json({ error: `unknown provider "${provider}"` }, 400);
    if (request.method === "PUT") {
      if (!env.AI_KEYS_KEK) return json({ error: "key vault not configured" }, 500);
      const body = (await request.json().catch(() => ({}))) as { key?: string };
      const key = (body.key || "").trim();
      if (!key) return json({ error: "key is required" }, 400);
      if (key.length > 512) return json({ error: "key too long" }, 400);
      await saveUserKey(env, user.id, provider, key);
      return json({ ok: true });
    }
    if (request.method === "DELETE") {
      await deleteUserKey(env, user.id, provider);
      return json({ ok: true });
    }
  }
  return json({ error: "not found" }, 404);
}
