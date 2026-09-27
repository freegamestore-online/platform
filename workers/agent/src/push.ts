/** Web Push — send no-payload push notifications via VAPID. */

export interface PushSubscription {
  endpoint: string;
  keys?: { p256dh: string; auth: string };
}

/**
 * A subscription endpoint comes from the browser, so validate it before
 * persisting or fetching it. Web Push endpoints are always HTTPS; rejecting
 * other schemes also prevents the notification sender from becoming an
 * authenticated user's generic outbound-request primitive.
 */
export function isValidPushSubscription(value: unknown): value is PushSubscription {
  if (!value || typeof value !== "object") return false;
  const endpoint = (value as { endpoint?: unknown }).endpoint;
  if (typeof endpoint !== "string" || endpoint.length === 0 || endpoint.length > 2048) return false;
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}

/**
 * Send a no-payload push notification. The service worker shows a
 * predefined message when it receives the push event.
 * Returns true on success (HTTP 201), false on failure.
 */
export async function sendWebPush(
  subscription: PushSubscription,
  vapidPublicKey: string,
  vapidPrivateKey: string,
  contactDomain: string,
): Promise<boolean> {
  if (!isValidPushSubscription(subscription)) return false;
  const url = new URL(subscription.endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const jwt = await createVapidJWT(audience, vapidPublicKey, vapidPrivateKey, contactDomain);

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `vapid t=${jwt}, k=${vapidPublicKey}`,
      TTL: "86400",
      "Content-Length": "0",
    },
  });

  return res.status === 201;
}

// ── VAPID JWT ──

async function createVapidJWT(audience: string, publicKey: string, privateKey: string, contactDomain: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const jwtHeader = b64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const jwtPayload = b64url(
    JSON.stringify({
      aud: audience,
      exp: now + 86400,
      // Store-derived contact so an FGS worker self-identifies as FGS (not the
      // vendored FAS default). Push services require a valid mailto/https `sub`
      // but don't verify the domain — this is correct branding, not auth.
      sub: `mailto:noreply@${contactDomain}`,
    }),
  );
  const unsigned = `${jwtHeader}.${jwtPayload}`;

  const pubBytes = b64urlDecode(publicKey);
  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: b64urlEncode(pubBytes.slice(1, 33)),
    y: b64urlEncode(pubBytes.slice(33, 65)),
    d: privateKey,
  };

  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);

  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(unsigned));

  return `${unsigned}.${b64urlEncode(new Uint8Array(sig))}`;
}

// ── Base64url helpers ──

function b64url(str: string): string {
  return btoa(str).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function b64urlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function b64urlDecode(str: string): Uint8Array {
  return Uint8Array.from(atob(str.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
}
