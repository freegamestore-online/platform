/**
 * AI key vault — server-side encrypted storage of users' BYOK API keys.
 *
 * Keys are encrypted at rest with AES-256-GCM. The AES key is derived from the
 * worker's JWT_SECRET (SHA-256), so no new secret has to be provisioned. The
 * vault is per-user and only the authenticated owner can read their own keys
 * back (plaintext is returned only to that user's session so the console can
 * use it for VibeCode). Benefit over localStorage-only: encrypted at rest,
 * survives logout/device, syncs across browsers.
 */

const SCHEMA = `CREATE TABLE IF NOT EXISTS ai_keys (
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, provider)
)`;

let schemaReady = false;
async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaReady) return;
  await db.prepare(SCHEMA).run();
  schemaReady = true;
}

async function aesKey(secret: string): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function toB64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function fromB64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

/** Provider names that have a stored key (no values). */
export async function vaultList(db: D1Database, userId: string): Promise<string[]> {
  await ensureSchema(db);
  const { results } = await db.prepare("SELECT provider FROM ai_keys WHERE user_id = ?").bind(userId).all();
  return (results as { provider: string }[]).map((r) => r.provider);
}

export async function vaultSet(db: D1Database, secret: string, userId: string, provider: string, key: string): Promise<void> {
  await ensureSchema(db);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(secret), new TextEncoder().encode(key));
  await db
    .prepare(
      `INSERT INTO ai_keys (user_id, provider, ciphertext, iv, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, provider) DO UPDATE SET
         ciphertext = excluded.ciphertext, iv = excluded.iv, updated_at = datetime('now')`,
    )
    .bind(userId, provider, toB64(ct), toB64(iv.buffer))
    .run();
}

/** Decrypted key for the owner, or null if not set. */
export async function vaultGet(db: D1Database, secret: string, userId: string, provider: string): Promise<string | null> {
  await ensureSchema(db);
  const row = (await db
    .prepare("SELECT ciphertext, iv FROM ai_keys WHERE user_id = ? AND provider = ?")
    .bind(userId, provider)
    .first()) as { ciphertext: string; iv: string } | null;
  if (!row) return null;
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(row.iv) }, await aesKey(secret), fromB64(row.ciphertext));
  return new TextDecoder().decode(pt);
}

export async function vaultDelete(db: D1Database, userId: string, provider: string): Promise<void> {
  await ensureSchema(db);
  await db.prepare("DELETE FROM ai_keys WHERE user_id = ? AND provider = ?").bind(userId, provider).run();
}
