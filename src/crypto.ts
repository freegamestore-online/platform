/**
 * Envelope encryption for user AI-provider keys (BYO key vault).
 * Vendored from FAS `packages/backend/src/lib/encryption.ts` (workspace rule:
 * copy, don't cross-depend). Kept byte-compatible so the pattern stays auditable
 * against the other stores.
 *
 *   plaintext key → AES-256-GCM(DEK) → key_ciphertext
 *   DEK           → AES-256-GCM(KEK) → dek_wrapped   (iv_kek prepended)
 *
 * Why envelope (vs. encrypting each key directly with the master KEK):
 *   - KEK rotation = re-wrap each row's DEK in place; key_ciphertext untouched.
 *   - Per-row DEK: a leaked DEK exposes exactly one key.
 *   - A DB dump alone yields only ciphertext — the attacker also needs the KEK,
 *     which lives only in env.AI_KEYS_KEK (a Worker secret), never in D1.
 *
 * KEK = base64-encoded 32 random bytes. Set once via:
 *   wrangler secret put AI_KEYS_KEK        (paste `openssl rand -base64 32`)
 */

export interface SealedSecret {
  /** AES-256-GCM ciphertext of the API key (includes the auth tag). */
  keyCiphertext: Uint8Array;
  /** DEK encrypted under the KEK (iv_kek prepended; includes auth tag). */
  dekWrapped: Uint8Array;
  /** 12-byte IV used for the key-ciphertext encryption. */
  iv: Uint8Array;
}

const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // GCM standard
const KEK_IV_LENGTH = 12;

/** Encrypt an API key: fresh DEK + IV per call, DEK wrapped under the KEK. */
export async function sealSecret(plaintext: string, kekBase64: string): Promise<SealedSecret> {
  const kek = await importKek(kekBase64);

  const dekRaw = crypto.getRandomValues(new Uint8Array(KEY_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const dek = await crypto.subtle.importKey("raw", dekRaw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);

  const plaintextBytes = new TextEncoder().encode(plaintext);
  const keyCiphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, dek, plaintextBytes));

  const ivKek = crypto.getRandomValues(new Uint8Array(KEK_IV_LENGTH));
  const wrapped = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: ivKek }, kek, dekRaw));
  const dekWrapped = new Uint8Array(KEK_IV_LENGTH + wrapped.byteLength);
  dekWrapped.set(ivKek, 0);
  dekWrapped.set(wrapped, KEK_IV_LENGTH);

  return { keyCiphertext, dekWrapped, iv };
}

/** Decrypt a sealed secret. Throws on bad ciphertext / wrong KEK / tampered tag. */
export async function openSecret(sealed: SealedSecret, kekBase64: string): Promise<string> {
  const kek = await importKek(kekBase64);

  const ivKek = sealed.dekWrapped.slice(0, KEK_IV_LENGTH);
  const wrappedBody = sealed.dekWrapped.slice(KEK_IV_LENGTH);
  const dekRaw = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: ivKek }, kek, wrappedBody));

  const dek = await crypto.subtle.importKey("raw", dekRaw, { name: "AES-GCM" }, false, ["decrypt"]);
  const plaintextBytes = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: sealed.iv }, dek, sealed.keyCiphertext));
  return new TextDecoder().decode(plaintextBytes);
}

async function importKek(kekBase64: string): Promise<CryptoKey> {
  const raw = base64ToBytes(kekBase64);
  if (raw.byteLength !== KEY_LENGTH) {
    throw new Error(`AI_KEYS_KEK must be ${KEY_LENGTH} bytes base64-encoded (got ${raw.byteLength})`);
  }
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
