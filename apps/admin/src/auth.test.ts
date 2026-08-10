import { describe, expect, it } from "vitest";
import { mintSessionToken, verifySession } from "./auth";

// The admin session token (HS256, self-signed by this worker). `fgs login`
// exchanges a GitHub token for one of these; it authenticates the creator CLI +
// admin session. mint → verify round-trips; tampering or expiry → null.

const KEY = "unit-test-signing-key";

describe("admin session tokens", () => {
  it("mint → verify returns the original login", async () => {
    const token = await mintSessionToken("serge-the-dev", KEY);
    expect(token.split(".")).toHaveLength(3);
    expect(await verifySession(token, KEY)).toBe("serge-the-dev");
  });

  it("rejects a token signed with a different key", async () => {
    const token = await mintSessionToken("serge-the-dev", KEY);
    expect(await verifySession(token, "some-other-key")).toBeNull();
  });

  it("rejects a token whose payload was tampered with (signature no longer matches)", async () => {
    const token = await mintSessionToken("serge-the-dev", KEY);
    const [header, , sig] = token.split(".");
    // Swap the payload for one claiming to be a different user, keep the old sig.
    const forgedBody = btoa(
      JSON.stringify({ sub: "attacker", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 }),
    ).replace(/=+$/, "");
    const forged = `${header}.${forgedBody}.${sig}`;
    expect(await verifySession(forged, KEY)).toBeNull();
  });

  it("rejects a structurally-invalid token", async () => {
    expect(await verifySession("not-a-jwt", KEY)).toBeNull();
    expect(await verifySession("only.two", KEY)).toBeNull();
  });

  it("rejects an expired token (exp in the past) even with a valid signature", async () => {
    // Mint a genuinely-signed token whose exp is already past.
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(KEY),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })).replace(/=+$/, "");
    const body = btoa(
      JSON.stringify({ sub: "serge-the-dev", iat: 1000, exp: Math.floor(Date.now() / 1000) - 60, iss: "freegamestore" }),
    ).replace(/=+$/, "");
    const sigBuf = await crypto.subtle.sign("HMAC", key, encoder.encode(`${header}.${body}`));
    const sig = btoa(String.fromCharCode(...new Uint8Array(sigBuf))).replace(/=+$/, "");
    const expired = `${header}.${body}.${sig}`;
    // Sanity: the signature itself is valid — only expiry should fail it.
    expect(await verifySession(expired, KEY)).toBeNull();
  });

  it("fails closed when the signing key is empty (unforgeable-key guard)", async () => {
    const token = await mintSessionToken("serge-the-dev", KEY);
    expect(await verifySession(token, "")).toBeNull();
  });

  it("mintSessionToken throws when the signing key is empty", async () => {
    await expect(mintSessionToken("serge-the-dev", "")).rejects.toThrow(/SESSION_SIGNING_KEY/);
  });
});
