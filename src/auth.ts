// HS256 session verification — vendor-copied from pgs/admin (2026-05-28).
// The session token is minted by the shared FAS auth flow
// (SESSION_SIGNING_KEY shared via wrangler secret). Identity = GitHub login.

export async function verifySession(token: string, signingKey: string): Promise<string | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(signingKey),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );

    const sigData = encoder.encode(`${parts[0]}.${parts[1]}`);
    const sig = Uint8Array.from(atob(parts[2]!), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify("HMAC", key, sig, sigData);
    if (!valid) return null;

    const payload = JSON.parse(atob(parts[1]!)) as { sub: string; exp: number };
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload.sub;
  } catch {
    return null;
  }
}
