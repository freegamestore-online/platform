import { describe, expect, it } from "vitest";
import { openSecret, sealSecret } from "./crypto";

/** A deterministic 32-byte base64 KEK for tests (seeded so it's stable). */
function kekFrom(seed: number): string {
  const raw = new Uint8Array(32);
  for (let i = 0; i < 32; i++) raw[i] = (i * 31 + seed * 17 + 7) & 0xff;
  let s = "";
  for (const b of raw) s += String.fromCharCode(b);
  return btoa(s);
}

describe("crypto envelope (AES-256-GCM)", () => {
  const kek = kekFrom(1);

  it("round-trips a key through seal → open", async () => {
    const sealed = await sealSecret("sk-ant-api03-secret-value", kek);
    expect(await openSecret(sealed, kek)).toBe("sk-ant-api03-secret-value");
  });

  it("uses a fresh DEK/IV each call (same plaintext → different ciphertext)", async () => {
    const a = await sealSecret("identical", kek);
    const b = await sealSecret("identical", kek);
    expect(Array.from(a.keyCiphertext)).not.toEqual(Array.from(b.keyCiphertext));
    expect(Array.from(a.iv)).not.toEqual(Array.from(b.iv));
    // …but both still decrypt to the same plaintext.
    expect(await openSecret(a, kek)).toBe("identical");
    expect(await openSecret(b, kek)).toBe("identical");
  });

  it("cannot be opened with a different KEK", async () => {
    const sealed = await sealSecret("secret", kek);
    await expect(openSecret(sealed, kekFrom(2))).rejects.toBeDefined();
  });

  it("fails (auth-tag) on tampered ciphertext", async () => {
    const sealed = await sealSecret("secret", kek);
    sealed.keyCiphertext[0] ^= 0xff;
    await expect(openSecret(sealed, kek)).rejects.toBeDefined();
  });

  it("fails on a tampered wrapped DEK", async () => {
    const sealed = await sealSecret("secret", kek);
    sealed.dekWrapped[sealed.dekWrapped.length - 1] ^= 0xff;
    await expect(openSecret(sealed, kek)).rejects.toBeDefined();
  });

  it("rejects a wrong-length KEK", async () => {
    await expect(sealSecret("x", btoa("too-short"))).rejects.toThrow(/32 bytes/);
  });

  it("handles unicode + long keys", async () => {
    const long = "sk-" + "λ🔐".repeat(80);
    const sealed = await sealSecret(long, kek);
    expect(await openSecret(sealed, kek)).toBe(long);
  });
});
