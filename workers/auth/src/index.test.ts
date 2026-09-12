/**
 * Unit tests for auth worker utilities.
 * Uses Node's built-in test runner — no extra dependencies needed.
 *
 * Run: pnpm test
 *
 * These tests import the REAL helpers from src/index.ts (rather than
 * re-implementing them) so any drift in the production code is caught here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import worker, {
  base64urlEncode,
  base64urlDecode,
  safeRedirect,
  jwtSign,
  jwtVerify,
  handleMe,
  handleCallback,
  handleGitHubTokenExchange,
  handleGitHubCallback,
} from "./index";

// --- base64url (real helpers, imported) ---

test("base64urlEncode round-trips through base64urlDecode", () => {
  const original = JSON.stringify({ redirect: "https://freegamestore.online" });
  const encoded = base64urlEncode(original);
  assert.equal(base64urlDecode(encoded), original);
});

test("base64urlEncode produces URL-safe output (no +, /, or =)", () => {
  // Use a string long enough that standard base64 would include padding/special chars
  const encoded = base64urlEncode("hello world from freegamestore auth");
  assert.doesNotMatch(encoded, /[+/=]/);
});

test("base64urlDecode handles URL-safe input correctly", () => {
  const input = "aGVsbG8gd29ybGQ"; // "hello world" in base64url
  assert.equal(base64urlDecode(input), "hello world");
});

test("CORS allowed origin regex accepts *.freegamestore.online", () => {
  const ALLOWED_ORIGIN = /^https:\/\/[\w-]+\.freegamestore\.online$/;
  assert.ok(ALLOWED_ORIGIN.test("https://chess.freegamestore.online"));
  assert.ok(ALLOWED_ORIGIN.test("https://tetris.freegamestore.online"));
  assert.equal(ALLOWED_ORIGIN.test("https://evil.com"), false);
  assert.equal(ALLOWED_ORIGIN.test("https://freegamestore.online"), false); // apex handled separately
});

// --- safeRedirect: open-redirect / phishing guard ---
// An attacker-controlled `redirect` param is reflected into the Location header
// after login, so anything not on our own origins must fall back.

const FALLBACK = "https://freegamestore.online";

test("safeRedirect allows apex + subdomains of freegamestore.online (https only)", () => {
  assert.equal(safeRedirect("https://freegamestore.online"), "https://freegamestore.online/");
  assert.equal(safeRedirect("https://console.freegamestore.online/settings"), "https://console.freegamestore.online/settings");
  assert.equal(safeRedirect("https://chess.freegamestore.online/play"), "https://chess.freegamestore.online/play");
});

test("safeRedirect allows localhost / 127.0.0.1 on any port and http", () => {
  assert.equal(safeRedirect("http://localhost:5173/"), "http://localhost:5173/");
  assert.equal(safeRedirect("http://localhost:3000/callback"), "http://localhost:3000/callback");
  assert.equal(safeRedirect("http://127.0.0.1:8787/"), "http://127.0.0.1:8787/");
});

test("safeRedirect rejects foreign, suffix-spoof, protocol-relative, and scheme attacks", () => {
  // Wholly foreign host.
  assert.equal(safeRedirect("http://evil.com"), FALLBACK);
  assert.equal(safeRedirect("https://evil.com/phish"), FALLBACK);
  // Suffix spoof — host ENDS with the brand but on an attacker domain.
  assert.equal(safeRedirect("https://freegamestore.online.evil.com"), FALLBACK);
  // A subdomain label that merely contains the brand string is not a real subdomain.
  assert.equal(safeRedirect("https://notfreegamestore.online"), FALLBACK);
  // Protocol-relative — no scheme, parses relative → not an absolute URL we trust.
  assert.equal(safeRedirect("//evil.com"), FALLBACK);
  // Dangerous schemes.
  assert.equal(safeRedirect("javascript:alert(1)"), FALLBACK);
  assert.equal(safeRedirect("data:text/html,<script>alert(1)</script>"), FALLBACK);
  // http (non-loopback) is not allowed even for our own host — cookies are Secure.
  assert.equal(safeRedirect("http://freegamestore.online"), FALLBACK);
});

test("safeRedirect rejects empty / null / garbage input", () => {
  assert.equal(safeRedirect(null), FALLBACK);
  assert.equal(safeRedirect(undefined), FALLBACK);
  assert.equal(safeRedirect(""), FALLBACK);
  assert.equal(safeRedirect("not a url"), FALLBACK);
});

// --- jwtSign / jwtVerify round-trip + tamper + expiry ---

const SECRET = "test-jwt-secret-do-not-use-in-prod";

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

test("jwtVerify accepts a token minted by jwtSign and returns its claims", async () => {
  const token = await jwtSign({ sub: "github:42", name: "Ada", exp: nowSec() + 3600 }, SECRET);
  const payload = await jwtVerify(token, SECRET);
  assert.ok(payload);
  assert.equal(payload.sub, "github:42");
  assert.equal(payload.name, "Ada");
});

test("jwtVerify rejects a token whose signature byte was flipped", async () => {
  const token = await jwtSign({ sub: "github:42", exp: nowSec() + 3600 }, SECRET);
  const [h, b, sig] = token.split(".");
  // Flip the first character of the signature to a different base64url char.
  const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
  assert.equal(await jwtVerify(`${h}.${b}.${flipped}`, SECRET), null);
});

test("jwtVerify rejects a token signed with a different secret", async () => {
  const token = await jwtSign({ sub: "github:42", exp: nowSec() + 3600 }, SECRET);
  assert.equal(await jwtVerify(token, "some-other-secret"), null);
});

test("jwtVerify rejects an expired token (exp in the past)", async () => {
  const token = await jwtSign({ sub: "github:42", exp: nowSec() - 10 }, SECRET);
  assert.equal(await jwtVerify(token, SECRET), null);
});

test("jwtVerify rejects a token missing a numeric exp (never non-expiring)", async () => {
  const token = await jwtSign({ sub: "github:42" }, SECRET);
  assert.equal(await jwtVerify(token, SECRET), null);
});

// --- handleMe: email PII boundary ---
// Email is exposed ONLY over the worker-to-worker path (X-FGS-Token), never to a
// game subdomain calling /me with the browser cookie.

const ME_ENV = { JWT_SECRET: SECRET } as unknown as Parameters<typeof handleMe>[1];

async function mintToken(): Promise<string> {
  return jwtSign(
    { sub: "github:7", name: "Grace", login: "grace", avatar: "https://x/a.png", email: "grace@example.com", exp: nowSec() + 3600 },
    SECRET,
  );
}

test("handleMe includes email when authenticated via X-FGS-Token (worker-to-worker)", async () => {
  const token = await mintToken();
  const res = await handleMe(new Request("https://auth.freegamestore.online/me", { headers: { "X-FGS-Token": token } }), ME_ENV);
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.email, "grace@example.com");
  assert.equal(body.id, "github:7");
  assert.equal(body.login, "grace");
});

test("handleMe OMITS email when authenticated via the browser cookie only", async () => {
  const token = await mintToken();
  const res = await handleMe(
    new Request("https://auth.freegamestore.online/me", { headers: { Cookie: `fgs_token=${token}` } }),
    ME_ENV,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal("email" in body, false);
  assert.equal(body.id, "github:7");
});

test("handleMe returns 401 with no token", async () => {
  const res = await handleMe(new Request("https://auth.freegamestore.online/me"), ME_ENV);
  assert.equal(res.status, 401);
});

test("worker routes GET /me and enforces the same PII boundary via the cookie", async () => {
  const token = await mintToken();
  const res = await worker.fetch(
    new Request("https://auth.freegamestore.online/me", { headers: { Cookie: `fgs_token=${token}` } }),
    ME_ENV as never,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal("email" in body, false);
});

// --- handleCallback: verified-email + CSRF-nonce enforcement ---

/** A minimal D1 stub — the callback only issues a single upsert. */
function fakeDb() {
  return {
    prepare() {
      return {
        bind() {
          return { async run() {} };
        },
      };
    },
  };
}

/** Build a valid state param + matching nonce cookie for the CSRF check. */
function oauthState(redirect: string): { state: string; nonce: string } {
  const nonce = "test-nonce-123";
  const state = base64urlEncode(JSON.stringify({ redirect, nonce }));
  return { state, nonce };
}

test("handleCallback 403s on OAuth nonce mismatch (login-CSRF guard)", async () => {
  const { state } = oauthState("https://freegamestore.online");
  const req = new Request("https://auth.freegamestore.online/callback?code=abc&state=" + encodeURIComponent(state), {
    // Cookie nonce deliberately does NOT match the nonce embedded in `state`.
    headers: { Cookie: "fgs_oauth_state=WRONG-nonce" },
  });
  const env = { JWT_SECRET: SECRET, DB: fakeDb() } as unknown as Parameters<typeof handleCallback>[1];
  const res = await handleCallback(req, env);
  assert.equal(res.status, 403);
});

// --- handleGitHubCallback: CSRF-nonce enforcement ---
//
// GitHub is the login path the MCP's OAuth flow actually traverses (the Google
// callback above is the legacy player-auth path), so its nonce check is the one
// standing between a signed-in user and an attacker-driven sign-in. It was
// enforced but untested — these cover it directly.

test("handleGitHubCallback 403s when the cookie nonce does not match state", async () => {
  const { state } = oauthState("https://freegamestore.online");
  const req = new Request(
    "https://auth.freegamestore.online/callback/github?code=abc&state=" + encodeURIComponent(state),
    { headers: { Cookie: "fgs_oauth_state=WRONG-nonce" } },
  );
  const env = { JWT_SECRET: SECRET, DB: fakeDb() } as unknown as Parameters<typeof handleGitHubCallback>[1];
  const res = await handleGitHubCallback(req, env);
  assert.equal(res.status, 403);
});

test("handleGitHubCallback 403s when the nonce cookie is absent entirely", async () => {
  // Fails CLOSED: no cookie must never be read as "nothing to compare, proceed".
  const { state } = oauthState("https://freegamestore.online");
  const req = new Request(
    "https://auth.freegamestore.online/callback/github?code=abc&state=" + encodeURIComponent(state),
  );
  const env = { JWT_SECRET: SECRET, DB: fakeDb() } as unknown as Parameters<typeof handleGitHubCallback>[1];
  const res = await handleGitHubCallback(req, env);
  assert.equal(res.status, 403);
});

test("handleGitHubCallback 403s when state carries no nonce at all", async () => {
  // A state blob without a nonce must not satisfy the check by being "equal" to
  // an absent cookie value.
  const state = base64urlEncode(JSON.stringify({ redirect: "https://freegamestore.online" }));
  const req = new Request(
    "https://auth.freegamestore.online/callback/github?code=abc&state=" + encodeURIComponent(state),
    { headers: { Cookie: "fgs_oauth_state=some-nonce" } },
  );
  const env = { JWT_SECRET: SECRET, DB: fakeDb() } as unknown as Parameters<typeof handleGitHubCallback>[1];
  const res = await handleGitHubCallback(req, env);
  assert.equal(res.status, 403);
});

test("handleGitHubCallback 400s before any nonce work when code or state is missing", async () => {
  const env = { JWT_SECRET: SECRET, DB: fakeDb() } as unknown as Parameters<typeof handleGitHubCallback>[1];
  const noState = await handleGitHubCallback(
    new Request("https://auth.freegamestore.online/callback/github?code=abc"),
    env,
  );
  assert.equal(noState.status, 400);
  const noCode = await handleGitHubCallback(
    new Request("https://auth.freegamestore.online/callback/github?state=abc"),
    env,
  );
  assert.equal(noCode.status, 400);
});

test("handleCallback carries a null email claim when Google reports email_verified:false", async () => {
  const { state, nonce } = oauthState("https://freegamestore.online");
  const req = new Request("https://auth.freegamestore.online/callback?code=abc&state=" + encodeURIComponent(state), {
    headers: { Cookie: `fgs_oauth_state=${nonce}` },
  });
  const env = {
    JWT_SECRET: SECRET,
    GOOGLE_CLIENT_ID: "cid",
    GOOGLE_CLIENT_SECRET: "csecret",
    DB: fakeDb(),
  } as unknown as Parameters<typeof handleCallback>[1];

  // Stub the two outbound fetches: token exchange, then userinfo (unverified email).
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (u.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "at" }), { status: 200 });
    }
    if (u.includes("googleapis.com/oauth2/v3/userinfo")) {
      return new Response(JSON.stringify({ sub: "9", name: "Eve", email: "eve@example.com", email_verified: false }), {
        status: 200,
      });
    }
    throw new Error("unexpected fetch: " + u);
  }) as typeof fetch;

  try {
    const res = await handleCallback(req, env);
    assert.equal(res.status, 302);
    const cookie = res.headers.get("Set-Cookie") ?? "";
    const m = cookie.match(/fgs_token=([^;]+)/);
    assert.ok(m, "expected a session cookie to be set");
    const payload = await jwtVerify(m![1], SECRET);
    assert.ok(payload);
    assert.equal(payload.email, null); // unverified email must NOT be trusted
    assert.equal(payload.sub, "9");
  } finally {
    globalThis.fetch = realFetch;
  }
});

// --- handleGitHubTokenExchange: CI can mint a fresh fgs_token from a GitHub token ---

test("handleGitHubTokenExchange verifies a GitHub token and returns an FGS JWT", async () => {
  const env = { JWT_SECRET: SECRET, DB: fakeDb() } as unknown as Parameters<typeof handleGitHubTokenExchange>[1];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    assert.equal(u, "https://api.github.com/user");
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer gh-test");
    return new Response(JSON.stringify({ id: 42, login: "canary", avatar_url: "https://x/avatar.png", name: "Canary" }), {
      status: 200,
    });
  }) as typeof fetch;

  try {
    const res = await handleGitHubTokenExchange(
      new Request("https://auth.freegamestore.online/v1/token/github", {
        method: "POST",
        headers: { Authorization: "Bearer gh-test" },
      }),
      env,
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { token: string; login: string; expiresAt: number };
    assert.equal(body.login, "canary");
    assert.equal(typeof body.expiresAt, "number");
    const payload = await jwtVerify(body.token, SECRET);
    assert.ok(payload);
    assert.equal(payload.sub, "github:42");
    assert.equal(payload.login, "canary");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("handleGitHubTokenExchange rejects an invalid GitHub token", async () => {
  const env = { JWT_SECRET: SECRET, DB: fakeDb() } as unknown as Parameters<typeof handleGitHubTokenExchange>[1];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ message: "bad credentials" }), { status: 401 })) as typeof fetch;

  try {
    const res = await handleGitHubTokenExchange(
      new Request("https://auth.freegamestore.online/v1/token/github", {
        method: "POST",
        headers: { Authorization: "Bearer bad" },
      }),
      env,
    );
    assert.equal(res.status, 401);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("worker routes POST /v1/token/github", async () => {
  const env = { JWT_SECRET: SECRET, DB: fakeDb() } as unknown as Parameters<typeof worker.fetch>[1];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ id: 43, login: "route-canary", avatar_url: "https://x/avatar.png" }), { status: 200 })) as typeof fetch;

  try {
    const res = await worker.fetch(
      new Request("https://auth.freegamestore.online/v1/token/github", {
        method: "POST",
        headers: { Authorization: "Bearer gh-test" },
      }),
      env,
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { token: string; login: string };
    assert.equal(body.login, "route-canary");
    assert.ok(await jwtVerify(body.token, SECRET));
  } finally {
    globalThis.fetch = realFetch;
  }
});
