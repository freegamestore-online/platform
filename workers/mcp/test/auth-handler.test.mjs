// OAuth default-handler tests — the /authorize → auth worker → /callback hop.
//
// This is the security boundary the MCP owns: everything before it belongs to
// the auth worker (nonce-bound GitHub OAuth, see workers/auth/src/index.test.ts)
// and everything after it belongs to @cloudflare/workers-oauth-provider (/token,
// /register, PKCE). What is tested here is the part in between — stashing the
// client's request, refusing a stale or replayed one, and refusing to mint a
// grant for an fgs_token the auth worker will not vouch for.
//
// Imports the real auth-handler.ts (Node strips the types on import), with the
// OAuthProvider helpers, the audit KV, and the AUTH service binding faked.
import assert from "node:assert/strict";
import { test } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const { default: handler } = await import(resolve(root, "src/auth-handler.ts"));

const AUTH_BASE = "https://auth.freegamestore.online";
const ORIGIN = "https://mcp.freegamestore.online";

// -- fakes --

function fakeKV() {
  const store = new Map();
  return {
    _store: store,
    async put(key, val) { store.set(key, val); },
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async delete(key) { store.delete(key); },
  };
}

/** OAUTH_PROVIDER stand-in. `parseThrows` models an unknown/stale client id —
 *  the real parseAuthRequest throws "Invalid client" when the KV registration
 *  is gone (e.g. the client registered against an earlier deployment). */
function fakeProvider({ parseThrows = false, parsed } = {}) {
  const calls = { parseAuthRequest: 0, completeAuthorization: [] };
  return {
    calls,
    async parseAuthRequest() {
      calls.parseAuthRequest++;
      if (parseThrows) throw new Error("Invalid client. The clientId provided does not match to this client.");
      return parsed ?? { clientId: "client-abc", redirectUri: "http://localhost:6274/callback", scope: [], state: "xyz" };
    },
    async completeAuthorization(options) {
      calls.completeAuthorization.push(options);
      return { redirectTo: "http://localhost:6274/callback?code=granted&state=xyz" };
    },
  };
}

/** AUTH service binding stand-in — the auth worker's /me, which is the only
 *  thing that can vouch for an fgs_token signature. */
function fakeAuth({ ok = true } = {}) {
  const calls = [];
  return {
    calls,
    async fetch(url, init) {
      calls.push({ url: String(url), headers: init?.headers ?? {} });
      return ok
        ? new Response(JSON.stringify({ id: "github:7", login: "grace" }), { status: 200 })
        : new Response(JSON.stringify({ error: "Invalid or expired token" }), { status: 401 });
    },
  };
}

function makeEnv(overrides = {}) {
  return {
    OAUTH_PROVIDER: fakeProvider(),
    OAUTH_KV: fakeKV(),
    AUTH_BASE,
    AUTH: fakeAuth(),
    ...overrides,
  };
}

/** An fgs_token-shaped JWT. Only the payload is ever read here (decodeLogin is
 *  an unsigned best-effort read); the signature is the auth worker's job. */
function jwtWithPayload(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `eyJhbGciOiJIUzI1NiJ9.${body}.c2ln`;
}

const GRACE = jwtWithPayload({ sub: "github:7", login: "grace", name: "Grace", exp: 2000000000 });

const get = (path, headers = {}) => new Request(`${ORIGIN}${path}`, { headers });

/** Pull the reqId the handler minted out of its redirect to the auth worker. */
function reqIdFromLoginRedirect(location) {
  const callback = new URL(new URL(location).searchParams.get("redirect"));
  return callback.searchParams.get("reqId");
}

// -- /authorize --

test("/authorize stashes the client request and bounces to the auth worker", async () => {
  const env = makeEnv();
  const res = await handler.fetch(get("/authorize?client_id=client-abc&response_type=code"), env);

  assert.equal(res.status, 302);
  const location = res.headers.get("location");
  assert.ok(location.startsWith(`${AUTH_BASE}/login?`), `expected a bounce to the auth worker, got ${location}`);

  // The return address must be OUR /callback, carrying a reqId.
  const callback = new URL(new URL(location).searchParams.get("redirect"));
  assert.equal(callback.origin, ORIGIN);
  assert.equal(callback.pathname, "/callback");
  const reqId = callback.searchParams.get("reqId");
  assert.ok(reqId, "expected a reqId on the callback URL");

  // ...and the parsed request is what got stashed under it.
  const stashed = JSON.parse(await env.OAUTH_KV.get(`mcpauthreq:${reqId}`));
  assert.equal(stashed.clientId, "client-abc");
  assert.equal(stashed.state, "xyz");
});

test("/authorize 400s on an unknown or stale client registration", async () => {
  // mcp-remote caches a client_id; when the registration is gone the client must
  // get a 400 it can recover from by re-registering, not a 500.
  const env = makeEnv({ OAUTH_PROVIDER: fakeProvider({ parseThrows: true }) });
  const res = await handler.fetch(get("/authorize?client_id=stale"), env);

  assert.equal(res.status, 400);
  assert.match(await res.text(), /invalid_client/);
  assert.equal(env.OAUTH_KV._store.size, 0, "nothing should be stashed for a rejected client");
});

test("/authorize 400s when the request carries no client_id", async () => {
  const env = makeEnv({ OAUTH_PROVIDER: fakeProvider({ parsed: { clientId: "", scope: [] } }) });
  const res = await handler.fetch(get("/authorize"), env);

  assert.equal(res.status, 400);
  assert.match(await res.text(), /invalid_request/);
  assert.equal(env.OAUTH_KV._store.size, 0);
});

// -- /callback: request-state handling --

test("/callback 400s with no reqId at all", async () => {
  const env = makeEnv();
  const res = await handler.fetch(get("/callback", { Cookie: `fgs_token=${GRACE}` }), env);

  assert.equal(res.status, 400);
  assert.match(await res.text(), /invalid or expired/i);
  assert.equal(env.OAUTH_PROVIDER.calls.completeAuthorization.length, 0);
});

test("/callback 400s on an expired or forged reqId", async () => {
  // A reqId that was never issued is indistinguishable from one whose 600s KV
  // TTL lapsed — both must fail closed before the cookie is even read.
  const env = makeEnv();
  const res = await handler.fetch(
    get(`/callback?reqId=${crypto.randomUUID()}`, { Cookie: `fgs_token=${GRACE}` }),
    env,
  );

  assert.equal(res.status, 400);
  assert.equal(env.OAUTH_PROVIDER.calls.completeAuthorization.length, 0);
  assert.equal(env.AUTH.calls.length, 0, "must not spend an auth-worker call on an unknown reqId");
});

test("/callback consumes the reqId — a replayed callback URL 400s", async () => {
  const env = makeEnv();
  const authorize = await handler.fetch(get("/authorize?client_id=client-abc"), env);
  const reqId = reqIdFromLoginRedirect(authorize.headers.get("location"));

  const first = await handler.fetch(get(`/callback?reqId=${reqId}`, { Cookie: `fgs_token=${GRACE}` }), env);
  assert.equal(first.status, 302);

  const replay = await handler.fetch(get(`/callback?reqId=${reqId}`, { Cookie: `fgs_token=${GRACE}` }), env);
  assert.equal(replay.status, 400, "a reqId must be single-use");
  assert.equal(env.OAUTH_PROVIDER.calls.completeAuthorization.length, 1, "replay must not mint a second grant");
});

// -- /callback: session handling --

test("/callback 401s when the browser arrives without the session cookie", async () => {
  const env = makeEnv();
  const authorize = await handler.fetch(get("/authorize?client_id=client-abc"), env);
  const reqId = reqIdFromLoginRedirect(authorize.headers.get("location"));

  const res = await handler.fetch(get(`/callback?reqId=${reqId}`), env);

  assert.equal(res.status, 401);
  assert.match(await res.text(), /no session cookie/i);
  assert.equal(env.OAUTH_PROVIDER.calls.completeAuthorization.length, 0);
});

test("/callback 401s when the auth worker rejects the token, and mints nothing", async () => {
  // decodeLogin() is an UNSIGNED read, so a forged fgs_token would otherwise set
  // props.userId to any GitHub login and walk through the ownership gate. The
  // /me verification is the only thing standing between the two.
  const env = makeEnv({ AUTH: fakeAuth({ ok: false }) });
  const authorize = await handler.fetch(get("/authorize?client_id=client-abc"), env);
  const reqId = reqIdFromLoginRedirect(authorize.headers.get("location"));

  const forged = jwtWithPayload({ sub: "github:1", login: "attacker", exp: 2000000000 });
  const res = await handler.fetch(get(`/callback?reqId=${reqId}`, { Cookie: `fgs_token=${forged}` }), env);

  assert.equal(res.status, 401);
  assert.match(await res.text(), /invalid or expired session token/i);
  assert.equal(env.OAUTH_PROVIDER.calls.completeAuthorization.length, 0, "a rejected token must not produce a grant");
});

test("/callback verifies via the AUTH service binding using the X-FGS-Token header", async () => {
  // Cloudflare strips Authorization/Cookie on worker-to-worker hops, and a
  // same-zone public-hostname fetch returns CF 522 — hence the service binding
  // plus X-FGS-Token rather than a plain fetch to auth.freegamestore.online.
  const env = makeEnv();
  const authorize = await handler.fetch(get("/authorize?client_id=client-abc"), env);
  const reqId = reqIdFromLoginRedirect(authorize.headers.get("location"));

  await handler.fetch(get(`/callback?reqId=${reqId}`, { Cookie: `fgs_token=${GRACE}` }), env);

  assert.equal(env.AUTH.calls.length, 1);
  assert.match(env.AUTH.calls[0].url, /\/me$/);
  assert.equal(env.AUTH.calls[0].headers["X-FGS-Token"], GRACE);
});

test("/callback completes the authorization with the verified identity and token props", async () => {
  const env = makeEnv();
  const authorize = await handler.fetch(get("/authorize?client_id=client-abc"), env);
  const reqId = reqIdFromLoginRedirect(authorize.headers.get("location"));

  const res = await handler.fetch(get(`/callback?reqId=${reqId}`, { Cookie: `fgs_token=${GRACE}` }), env);

  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "http://localhost:6274/callback?code=granted&state=xyz");

  const [completed] = env.OAUTH_PROVIDER.calls.completeAuthorization;
  assert.equal(completed.userId, "grace", "userId must be the login claim, not the raw sub");
  assert.equal(completed.request.clientId, "client-abc");
  assert.equal(completed.request.state, "xyz", "the client's state must survive the round trip");
  // props are what reach the MCP tools as this.props.
  assert.equal(completed.props.token, GRACE);
  assert.equal(completed.props.userId, "grace");
});

test("/callback falls back to the sub claim, then to a placeholder, when login is absent", async () => {
  const subOnly = jwtWithPayload({ sub: "github:7", exp: 2000000000 });
  const env = makeEnv();
  let authorize = await handler.fetch(get("/authorize?client_id=client-abc"), env);
  let reqId = reqIdFromLoginRedirect(authorize.headers.get("location"));
  await handler.fetch(get(`/callback?reqId=${reqId}`, { Cookie: `fgs_token=${subOnly}` }), env);
  assert.equal(env.OAUTH_PROVIDER.calls.completeAuthorization[0].userId, "github:7");

  // An undecodable payload must not throw — the token is still verified, so the
  // grant is real; only the display identity is unknown.
  authorize = await handler.fetch(get("/authorize?client_id=client-abc"), env);
  reqId = reqIdFromLoginRedirect(authorize.headers.get("location"));
  await handler.fetch(get(`/callback?reqId=${reqId}`, { Cookie: "fgs_token=not.a-valid-payload.sig" }), env);
  assert.equal(env.OAUTH_PROVIDER.calls.completeAuthorization[1].userId, "user");
});

test("/callback reads fgs_token from a multi-cookie header and ignores lookalike names", async () => {
  const env = makeEnv();
  const authorize = await handler.fetch(get("/authorize?client_id=client-abc"), env);
  const reqId = reqIdFromLoginRedirect(authorize.headers.get("location"));

  const res = await handler.fetch(
    get(`/callback?reqId=${reqId}`, { Cookie: `theme=dark; fgs_token=${GRACE}; cf_clearance=abc` }),
    env,
  );
  assert.equal(res.status, 302);
  assert.equal(env.OAUTH_PROVIDER.calls.completeAuthorization[0].props.token, GRACE);
});

test("/callback does not accept a cookie whose name merely ends in fgs_token", async () => {
  const env = makeEnv();
  const authorize = await handler.fetch(get("/authorize?client_id=client-abc"), env);
  const reqId = reqIdFromLoginRedirect(authorize.headers.get("location"));

  const res = await handler.fetch(get(`/callback?reqId=${reqId}`, { Cookie: `x_fgs_token=${GRACE}` }), env);
  assert.equal(res.status, 401);
});

// -- root path: the reconnect / redial contract --

test("GET / with an SSE Accept 405s instead of opening a dead stream", async () => {
  // A 200 with a non-stream body reads to the client as "stream opened, then
  // dropped" and it redials ~1/sec forever. 405 is the wrong-number answer.
  const res = await handler.fetch(get("/", { accept: "text/event-stream" }), makeEnv());

  assert.equal(res.status, 405);
  assert.equal(res.headers.get("allow"), "GET, HEAD");
  const body = await res.json();
  assert.equal(body.jsonrpc, "2.0");
  assert.equal(body.error.code, -32000);
  assert.match(body.error.message, /mcp\.freegamestore\.online\/mcp/);
});

test("POST / (JSON-RPC at the origin) 405s and points at the real endpoint", async () => {
  const res = await handler.fetch(new Request(`${ORIGIN}/`, { method: "POST", body: "{}" }), makeEnv());

  assert.equal(res.status, 405);
  assert.match((await res.json()).error.message, /\/mcp$/);
});

test("GET / from a browser serves the plain-text connect instructions", async () => {
  const res = await handler.fetch(get("/"), makeEnv());

  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/plain/);
  assert.match(await res.text(), /mcp-remote https:\/\/mcp\.freegamestore\.online\/mcp/);
});

test("an unrouted path 404s", async () => {
  const res = await handler.fetch(get("/nope"), makeEnv());
  assert.equal(res.status, 404);
});
