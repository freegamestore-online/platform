// OAuth default-handler tests — the /authorize → auth worker → /callback hop.
//
// This is the security boundary the MCP owns: everything before it belongs to
// the auth worker (nonce-bound GitHub OAuth, see workers/auth/src/index.test.ts)
// and everything after it belongs to @cloudflare/workers-oauth-provider (/token,
// /register, PKCE). What is tested here is the part in between — stashing the
// client's request, proving the browser that returns is the one that left,
// refusing a stale or replayed request, and refusing to mint a grant for an
// fgs_token the auth worker will not vouch for.
//
// The callback is two legs: GET renders the consent page (nothing consumed or
// minted), POST is the decision (stash consumed either way; only `allow` mints).
//
// Imports the real auth-handler.ts (Node strips the types on import), with the
// OAuthProvider helpers, the audit KV, and the AUTH service binding faked.
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const { default: handler } = await import(resolve(root, 'src/auth-handler.ts'));

const AUTH_BASE = 'https://auth.freegamestore.online';
const ORIGIN = 'https://mcp.freegamestore.online';

// -- fakes --

function fakeKV() {
  const store = new Map();
  return {
    _store: store,
    async put(key, val) {
      store.set(key, val);
    },
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

/** OAUTH_PROVIDER stand-in. `parseThrows` models an unknown/stale client id —
 *  the real parseAuthRequest throws "Invalid client" when the KV registration
 *  is gone (e.g. the client registered against an earlier deployment). */
function fakeProvider({
  parseThrows = false,
  parsed,
  client = { clientName: 'Claude Code' },
} = {}) {
  const calls = { parseAuthRequest: 0, completeAuthorization: [], lookupClient: [] };
  return {
    calls,
    /** `client: null` models a registration that vanished between /authorize
     *  and /callback (KV TTL, rotated client store). */
    async lookupClient(clientId) {
      calls.lookupClient.push(clientId);
      return client ? { clientId, ...client } : null;
    },
    async parseAuthRequest() {
      calls.parseAuthRequest++;
      if (parseThrows)
        throw new Error('Invalid client. The clientId provided does not match to this client.');
      return (
        parsed ?? {
          clientId: 'client-abc',
          redirectUri: 'http://localhost:6274/callback',
          scope: [],
          state: 'xyz',
          // The real parseAuthRequest ALWAYS returns a codeChallengeMethod —
          // it defaults the absent case to "plain" rather than undefined — so
          // the stub models that rather than omitting the field. Default to a
          // well-formed S256 request; the PKCE-rejection tests pass their own
          // `parsed` to model a client that omits or downgrades it.
          codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
          codeChallengeMethod: 'S256',
        }
      );
    },
    async completeAuthorization(options) {
      calls.completeAuthorization.push(options);
      return { redirectTo: 'http://localhost:6274/callback?code=granted&state=xyz' };
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
        ? new Response(JSON.stringify({ id: 'github:7', login: 'grace' }), { status: 200 })
        : new Response(JSON.stringify({ error: 'Invalid or expired token' }), { status: 401 });
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
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `eyJhbGciOiJIUzI1NiJ9.${body}.c2ln`;
}

const GRACE = jwtWithPayload({ sub: 'github:7', login: 'grace', name: 'Grace', exp: 2000000000 });

const get = (path, headers = {}) => new Request(`${ORIGIN}${path}`, { headers });
const cookies = (...pairs) => pairs.filter(Boolean).join('; ');

/**
 * Drive /authorize the way a browser would and keep what it hands back: the
 * reqId on the return address, and the nonce cookie the browser would store.
 * Every /callback test starts here, because a callback that did not come from
 * an /authorize is exactly what the handler is supposed to reject.
 */
async function startFlow(env, query = 'client_id=client-abc') {
  const res = await handler.fetch(get(`/authorize?${query}`), env);
  const location = res.headers.get('location');
  const callback = new URL(new URL(location).searchParams.get('redirect'));
  const setCookie = res.headers.get('set-cookie') ?? '';
  return {
    res,
    location,
    reqId: callback.searchParams.get('reqId'),
    // "__Host-mcp_csrf_<reqId>=<nonce>" — what the browser would send back.
    csrf: setCookie.split(';')[0],
  };
}

/** GET /callback — the consent page. */
const consent = (env, reqId, cookie) =>
  handler.fetch(get(`/callback?reqId=${reqId}`, cookie ? { Cookie: cookie } : {}), env);

/** POST /callback — the decision, as the consent form would submit it. */
const decide = (env, reqId, cookie, action = 'allow') =>
  handler.fetch(
    new Request(`${ORIGIN}/callback`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: new URLSearchParams({ reqId, action }).toString(),
    }),
    env,
  );

// -- /authorize --

test('/authorize stashes the client request and bounces to the auth worker', async () => {
  const env = makeEnv();
  const { res, location, reqId } = await startFlow(env);

  assert.equal(res.status, 302);
  assert.ok(
    location.startsWith(`${AUTH_BASE}/login?`),
    `expected a bounce to the auth worker, got ${location}`,
  );

  // The return address must be OUR /callback, carrying a reqId.
  const callback = new URL(new URL(location).searchParams.get('redirect'));
  assert.equal(callback.origin, ORIGIN);
  assert.equal(callback.pathname, '/callback');
  assert.ok(reqId, 'expected a reqId on the callback URL');

  // ...and the parsed request is what got stashed under it.
  const stashed = JSON.parse(await env.OAUTH_KV.get(`mcpauthreq:${reqId}`));
  assert.equal(stashed.req.clientId, 'client-abc');
  assert.equal(stashed.req.state, 'xyz');
});

test('/authorize sets a __Host- nonce cookie bound to the reqId', async () => {
  const env = makeEnv();
  const { res, reqId } = await startFlow(env);
  const setCookie = res.headers.get('set-cookie');

  assert.ok(setCookie, 'expected a nonce cookie');
  assert.match(
    setCookie,
    new RegExp(`^__Host-mcp_csrf_${reqId}=`),
    'cookie name must bind the reqId',
  );
  // __Host- forbids a Domain attribute, which is what stops a user-authored game
  // on a sibling *.freegamestore.online subdomain from forging this nonce.
  assert.doesNotMatch(setCookie, /Domain=/i);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /Path=\//);
  assert.match(setCookie, /Max-Age=600/);

  // The nonce must be the secret half — not the reqId, which is public.
  const nonce = setCookie.split(';')[0].split('=')[1];
  assert.notEqual(nonce, reqId);
  assert.equal(JSON.parse(await env.OAUTH_KV.get(`mcpauthreq:${reqId}`)).nonce, nonce);
});

test('/authorize 400s on an unknown or stale client registration', async () => {
  // mcp-remote caches a client_id; when the registration is gone the client must
  // get a 400 it can recover from by re-registering, not a 500.
  const env = makeEnv({ OAUTH_PROVIDER: fakeProvider({ parseThrows: true }) });
  const res = await handler.fetch(get('/authorize?client_id=stale'), env);

  assert.equal(res.status, 400);
  assert.match(await res.text(), /invalid_client/);
  assert.equal(env.OAUTH_KV._store.size, 0, 'nothing should be stashed for a rejected client');
  assert.equal(res.headers.get('set-cookie'), null, 'no nonce for a rejected client');
});

test('/authorize 400s when the request carries no client_id', async () => {
  const env = makeEnv({ OAUTH_PROVIDER: fakeProvider({ parsed: { clientId: '', scope: [] } }) });
  const res = await handler.fetch(get('/authorize'), env);

  assert.equal(res.status, 400);
  assert.match(await res.text(), /invalid_request/);
  assert.equal(env.OAUTH_KV._store.size, 0);
});

// PKCE (S256) is mandatory. The library only VERIFIES a code_challenge when one
// is PRESENT, so an omitted challenge degrades silently to redirect_uri matching
// rather than erroring — these tests are what keeps that absence loud.

const parsedWith = (extra) =>
  fakeProvider({
    parsed: {
      clientId: 'client-abc',
      redirectUri: 'http://localhost:6274/callback',
      scope: [],
      state: 'xyz',
      ...extra,
    },
  });

test('/authorize rejects a request carrying no code_challenge', async () => {
  // parseAuthRequest defaults an absent method to "plain", so that is what a
  // challenge-less client actually looks like by the time we see it.
  const env = makeEnv({ OAUTH_PROVIDER: parsedWith({ codeChallengeMethod: 'plain' }) });
  const res = await handler.fetch(get('/authorize?client_id=client-abc'), env);
  assert.equal(res.status, 400);
  assert.match(await res.text(), /code_challenge required/);
  // Rejected before anything is stashed, so no KV entry is left to expire.
  assert.equal(env.OAUTH_KV._store.size, 0);
  assert.equal(res.headers.get('set-cookie'), null);
});

test('/authorize rejects the plain PKCE method even with a challenge present', async () => {
  const env = makeEnv({
    OAUTH_PROVIDER: parsedWith({ codeChallenge: 'a-challenge', codeChallengeMethod: 'plain' }),
  });
  const res = await handler.fetch(get('/authorize?client_id=client-abc'), env);
  assert.equal(res.status, 400);
  assert.match(await res.text(), /must be S256/);
  assert.equal(env.OAUTH_KV._store.size, 0);
});

test('/authorize accepts a well-formed S256 request', async () => {
  const env = makeEnv();
  const res = await handler.fetch(get('/authorize?client_id=client-abc'), env);
  assert.equal(res.status, 302);
  assert.ok(res.headers.get('set-cookie')?.startsWith('__Host-mcp_csrf_'));
  assert.equal(env.OAUTH_KV._store.size, 1);
});

// -- /callback: CSRF binding --
//
// The reqId travels in the URL (GET) or the form body (POST), so on its own it
// proves nothing about WHO is completing the flow. These are the tests for the
// nonce cookie that does. Both legs must refuse without it.

test('/callback 400s when the nonce cookie is missing', async () => {
  const env = makeEnv();
  const { reqId } = await startFlow(env);

  const page = await consent(env, reqId, `fgs_token=${GRACE}`);
  assert.equal(page.status, 400);
  assert.match(await page.text(), /could not be verified/i);

  const post = await decide(env, reqId, `fgs_token=${GRACE}`);
  assert.equal(post.status, 400);

  assert.equal(env.OAUTH_PROVIDER.calls.completeAuthorization.length, 0);
  assert.equal(env.AUTH.calls.length, 0, 'must fail before the token is even looked at');
});

test('/callback 400s when the nonce cookie does not match the stashed nonce', async () => {
  const env = makeEnv();
  const { reqId } = await startFlow(env);
  const wrong = cookies(`__Host-mcp_csrf_${reqId}=${crypto.randomUUID()}`, `fgs_token=${GRACE}`);

  assert.equal((await consent(env, reqId, wrong)).status, 400);
  assert.equal((await decide(env, reqId, wrong)).status, 400);
  assert.equal(env.OAUTH_PROVIDER.calls.completeAuthorization.length, 0);
});

test("/callback refuses a victim walked through the attacker's authorization request", async () => {
  // The attack this binding exists to stop: the attacker registers a client,
  // starts /authorize to get a reqId, then gets a signed-in victim to open
  // /callback?reqId=<attacker's>. The victim's SameSite=Lax fgs_token rides the
  // top-level navigation and is genuinely valid — but the victim's browser holds
  // no nonce for the attacker's reqId, so nothing is shown and nothing is minted.
  const attacker = makeEnv();
  const { reqId: attackerReqId, csrf: attackerCsrf } = await startFlow(attacker);

  // The victim has their own flow open, so they do have A nonce — just not this one.
  const { csrf: victimCsrf } = await startFlow(attacker);
  const victim = cookies(victimCsrf, `fgs_token=${GRACE}`);

  assert.equal((await consent(attacker, attackerReqId, victim)).status, 400);
  // ...and a cross-site form post lands the same way (in a real browser the
  // Lax nonce cookie would not even be attached).
  assert.equal((await decide(attacker, attackerReqId, victim)).status, 400);
  assert.equal(
    attacker.OAUTH_PROVIDER.calls.completeAuthorization.length,
    0,
    "no grant for the victim's identity",
  );
  // Sanity: the attacker's own nonce is the only thing that would have worked,
  // and it never leaves the attacker's own browser.
  assert.match(attackerCsrf, new RegExp(`^__Host-mcp_csrf_${attackerReqId}=`));
});

test('/callback 400s on a malformed reqId before touching KV', async () => {
  // reqId becomes part of a cookie name, so it is pinned to the UUID shape we
  // mint rather than trusted from the query string or the form body.
  const env = makeEnv();
  for (const bad of ['../../etc', 'abc', '.*', '']) {
    const page = await consent(env, encodeURIComponent(bad), `fgs_token=${GRACE}`);
    assert.equal(page.status, 400, `expected 400 for GET reqId=${bad}`);
    const post = await decide(env, bad, `fgs_token=${GRACE}`);
    assert.equal(post.status, 400, `expected 400 for POST reqId=${bad}`);
  }
  assert.equal(env.OAUTH_PROVIDER.calls.completeAuthorization.length, 0);
});

test('/callback fails closed on a stash written before the nonce shipped', async () => {
  // In-flight flows across the deploy have no nonce in KV. They must be rejected
  // rather than silently accepted; the client just reconnects.
  const env = makeEnv();
  const reqId = crypto.randomUUID();
  await env.OAUTH_KV.put(
    `mcpauthreq:${reqId}`,
    JSON.stringify({ clientId: 'client-abc', scope: [] }),
  );
  const cookie = cookies(`__Host-mcp_csrf_${reqId}=anything`, `fgs_token=${GRACE}`);

  assert.equal((await consent(env, reqId, cookie)).status, 400);
  assert.equal((await decide(env, reqId, cookie)).status, 400);
  assert.equal(env.OAUTH_PROVIDER.calls.completeAuthorization.length, 0);
});

// -- /callback: request-state handling --

test('/callback 400s with no reqId at all', async () => {
  const env = makeEnv();
  const res = await handler.fetch(get('/callback', { Cookie: `fgs_token=${GRACE}` }), env);
  assert.equal(res.status, 400);
  assert.match(await res.text(), /invalid or expired/i);

  const post = await handler.fetch(
    new Request(`${ORIGIN}/callback`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        Cookie: `fgs_token=${GRACE}`,
      },
      body: 'action=allow',
    }),
    env,
  );
  assert.equal(post.status, 400);
  assert.equal(env.OAUTH_PROVIDER.calls.completeAuthorization.length, 0);
});

test('/callback 400s on an expired or forged reqId', async () => {
  // A reqId that was never issued is indistinguishable from one whose 600s KV
  // TTL lapsed — both must fail closed before the cookie is even read.
  const env = makeEnv();
  const res = await consent(env, crypto.randomUUID(), `fgs_token=${GRACE}`);

  assert.equal(res.status, 400);
  assert.equal(env.OAUTH_PROVIDER.calls.completeAuthorization.length, 0);
  assert.equal(env.AUTH.calls.length, 0, 'must not spend an auth-worker call on an unknown reqId');
});

test('GET /callback does not consume the reqId — reloading the consent page is fine', async () => {
  const env = makeEnv();
  const { reqId, csrf } = await startFlow(env);
  const cookie = cookies(csrf, `fgs_token=${GRACE}`);

  assert.equal((await consent(env, reqId, cookie)).status, 200);
  assert.equal((await consent(env, reqId, cookie)).status, 200);
  assert.equal(env.OAUTH_KV._store.size, 1, 'the stash must survive a page render');
  assert.equal(env.OAUTH_PROVIDER.calls.completeAuthorization.length, 0);
});

test('POST /callback consumes the reqId — a replayed decision 400s', async () => {
  const env = makeEnv();
  const { reqId, csrf } = await startFlow(env);
  const cookie = cookies(csrf, `fgs_token=${GRACE}`);

  const first = await decide(env, reqId, cookie);
  assert.equal(first.status, 302);

  const replay = await decide(env, reqId, cookie);
  assert.equal(replay.status, 400, 'a reqId must be single-use even with a valid nonce');
  assert.equal(
    env.OAUTH_PROVIDER.calls.completeAuthorization.length,
    1,
    'replay must not mint a second grant',
  );
  // ...and the consent page is gone too.
  assert.equal((await consent(env, reqId, cookie)).status, 400);
});

test('POST /callback deny consumes the reqId as well', async () => {
  const env = makeEnv();
  const { reqId, csrf } = await startFlow(env);
  const cookie = cookies(csrf, `fgs_token=${GRACE}`);

  assert.equal((await decide(env, reqId, cookie, 'deny')).status, 302);
  assert.equal(env.OAUTH_KV._store.size, 0);
  // A later "allow" cannot resurrect a declined request.
  assert.equal((await decide(env, reqId, cookie, 'allow')).status, 400);
  assert.equal(env.OAUTH_PROVIDER.calls.completeAuthorization.length, 0);
});

// -- /callback: the consent page (GET) --

test('GET /callback renders the consent page naming the client and the account', async () => {
  const env = makeEnv();
  const { reqId, csrf } = await startFlow(env);

  const res = await consent(env, reqId, cookies(csrf, `fgs_token=${GRACE}`));

  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const html = await res.text();
  assert.match(html, /Claude Code/, 'must name the client');
  assert.match(html, /grace/, 'must name the account');
  assert.match(html, /wants to use FreeGameStore MCP tools as/);
  // The decision is a form POST back to us, carrying the reqId.
  assert.match(html, /<form method="POST" action="\/callback">/);
  assert.match(html, new RegExp(`name="reqId" value="${reqId}"`));
  assert.match(html, /name="action" value="allow"/);
  assert.match(html, /name="action" value="deny"/);

  // The client was looked up by the id from the stash, not from the URL.
  assert.deepEqual(env.OAUTH_PROVIDER.calls.lookupClient, ['client-abc']);
  // Nothing minted, nothing consumed.
  assert.equal(env.OAUTH_PROVIDER.calls.completeAuthorization.length, 0);
  assert.equal(env.OAUTH_KV._store.size, 1);
});

test('GET /callback HTML-escapes the client name and the login', async () => {
  // Registration is open, so the client name is attacker-chosen text.
  const env = makeEnv({
    OAUTH_PROVIDER: fakeProvider({ client: { clientName: '<script>alert(1)</script>"&' } }),
  });
  const { reqId, csrf } = await startFlow(env);
  const evilLogin = jwtWithPayload({ sub: 'github:9', login: '<img src=x onerror=alert(2)>' });

  const html = await (await consent(env, reqId, cookies(csrf, `fgs_token=${evilLogin}`))).text();

  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;&quot;&amp;/);
  assert.match(html, /&lt;img src=x onerror=alert\(2\)&gt;/);
});

test('GET /callback falls back to a generic client name when the registration has none', async () => {
  const env = makeEnv({ OAUTH_PROVIDER: fakeProvider({ client: {} }) });
  const { reqId, csrf } = await startFlow(env);

  const html = await (await consent(env, reqId, cookies(csrf, `fgs_token=${GRACE}`))).text();
  assert.match(html, /your MCP client/);
});

test('GET /callback 400s when the client registration has vanished, and spends the stash', async () => {
  // The registration can lapse between /authorize and /callback. A page that
  // names nobody is worse than a reconnect prompt — fail closed and clean up.
  const env = makeEnv({ OAUTH_PROVIDER: fakeProvider({ client: null }) });
  const { reqId, csrf } = await startFlow(env);

  const res = await consent(env, reqId, cookies(csrf, `fgs_token=${GRACE}`));

  assert.equal(res.status, 400);
  assert.match(await res.text(), /invalid_client/);
  assert.match(res.headers.get('set-cookie'), new RegExp(`^__Host-mcp_csrf_${reqId}=;.*Max-Age=0`));
  assert.equal(env.OAUTH_KV._store.size, 0);
  assert.equal(env.OAUTH_PROVIDER.calls.completeAuthorization.length, 0);
});

// -- /callback: session handling --
//
// Both legs verify the session: the page must not name an account the auth
// worker will not vouch for, and the decision must not mint for one.

test('/callback 401s when the browser arrives without the session cookie', async () => {
  const env = makeEnv();
  const { reqId, csrf } = await startFlow(env);

  const page = await consent(env, reqId, csrf);
  assert.equal(page.status, 401);
  assert.match(await page.text(), /no session cookie/i);

  const post = await decide(env, reqId, csrf);
  assert.equal(post.status, 401);
  assert.equal(env.OAUTH_PROVIDER.calls.completeAuthorization.length, 0);
});

test('/callback 401s when the auth worker rejects the token, and mints nothing', async () => {
  // decodeLogin() is an UNSIGNED read, so a forged fgs_token would otherwise set
  // props.userId to any GitHub login and walk through the ownership gate. The
  // /me verification is the only thing standing between the two.
  const env = makeEnv({ AUTH: fakeAuth({ ok: false }) });
  const { reqId, csrf } = await startFlow(env);
  const forged = jwtWithPayload({ sub: 'github:1', login: 'attacker', exp: 2000000000 });
  const cookie = cookies(csrf, `fgs_token=${forged}`);

  const page = await consent(env, reqId, cookie);
  assert.equal(page.status, 401);
  assert.doesNotMatch(await page.text(), /attacker/, 'must not name an unverified account');

  const post = await decide(env, reqId, cookie);
  assert.equal(post.status, 401);
  assert.match(await post.text(), /invalid or expired session token/i);
  assert.equal(
    env.OAUTH_PROVIDER.calls.completeAuthorization.length,
    0,
    'a rejected token must not produce a grant',
  );
});

test('/callback verifies via the AUTH service binding using the X-FGS-Token header', async () => {
  // Cloudflare strips Authorization/Cookie on worker-to-worker hops, and a
  // same-zone public-hostname fetch returns CF 522 — hence the service binding
  // plus X-FGS-Token rather than a plain fetch to auth.freegamestore.online.
  const env = makeEnv();
  const { reqId, csrf } = await startFlow(env);
  const cookie = cookies(csrf, `fgs_token=${GRACE}`);

  await consent(env, reqId, cookie);
  await decide(env, reqId, cookie);

  // Once per leg: the GET's check proves nothing about the POST.
  assert.equal(env.AUTH.calls.length, 2);
  for (const call of env.AUTH.calls) {
    assert.match(call.url, /\/me$/);
    assert.equal(call.headers['X-FGS-Token'], GRACE);
  }
});

// -- /callback: the decision (POST) --

test('POST /callback allow completes the authorization with the verified identity and token props', async () => {
  const env = makeEnv();
  const { reqId, csrf } = await startFlow(env);

  const res = await decide(env, reqId, cookies(csrf, `fgs_token=${GRACE}`), 'allow');

  assert.equal(res.status, 302);
  assert.equal(
    res.headers.get('location'),
    'http://localhost:6274/callback?code=granted&state=xyz',
  );
  // The spent nonce is expired rather than left behind.
  assert.match(res.headers.get('set-cookie'), new RegExp(`^__Host-mcp_csrf_${reqId}=;.*Max-Age=0`));

  const [completed] = env.OAUTH_PROVIDER.calls.completeAuthorization;
  assert.equal(completed.userId, 'grace', 'userId must be the login claim, not the raw sub');
  assert.equal(completed.request.clientId, 'client-abc');
  assert.equal(completed.request.state, 'xyz', "the client's state must survive the round trip");
  // props are what reach the MCP tools as this.props.
  assert.equal(completed.props.token, GRACE);
  assert.equal(completed.props.userId, 'grace');
});

test('POST /callback deny sends the client access_denied and mints nothing', async () => {
  const env = makeEnv();
  const { reqId, csrf } = await startFlow(env);

  const res = await decide(env, reqId, cookies(csrf, `fgs_token=${GRACE}`), 'deny');

  assert.equal(res.status, 302);
  const back = new URL(res.headers.get('location'));
  // The registered redirect_uri, which parseAuthRequest already validated.
  assert.equal(back.origin + back.pathname, 'http://localhost:6274/callback');
  assert.equal(back.searchParams.get('error'), 'access_denied');
  assert.equal(back.searchParams.get('state'), 'xyz');
  assert.equal(back.searchParams.get('code'), null);
  assert.match(res.headers.get('set-cookie'), new RegExp(`^__Host-mcp_csrf_${reqId}=;.*Max-Age=0`));

  assert.equal(env.OAUTH_PROVIDER.calls.completeAuthorization.length, 0);
  // Declining needs no session: nothing is minted, so there is nothing to vouch for.
  assert.equal(env.AUTH.calls.length, 0);
});

test('POST /callback with an unknown action 400s and mints nothing', async () => {
  const env = makeEnv();
  const { reqId, csrf } = await startFlow(env);

  const res = await decide(env, reqId, cookies(csrf, `fgs_token=${GRACE}`), 'maybe');

  assert.equal(res.status, 400);
  assert.equal(env.OAUTH_PROVIDER.calls.completeAuthorization.length, 0);
});

test('POST /callback with a non-form body 400s', async () => {
  const env = makeEnv();
  const { reqId, csrf } = await startFlow(env);

  const res = await handler.fetch(
    new Request(`${ORIGIN}/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Cookie: cookies(csrf, `fgs_token=${GRACE}`) },
      body: JSON.stringify({ reqId, action: 'allow' }),
    }),
    env,
  );

  assert.equal(res.status, 400);
  assert.equal(env.OAUTH_PROVIDER.calls.completeAuthorization.length, 0);
});

test('no grant is minted without an explicit allow', async () => {
  // The whole point of the page: everything up to the click is inert.
  const env = makeEnv();
  const { reqId, csrf } = await startFlow(env);
  const cookie = cookies(csrf, `fgs_token=${GRACE}`);

  await consent(env, reqId, cookie);
  await consent(env, reqId, cookie);
  assert.equal(env.OAUTH_PROVIDER.calls.completeAuthorization.length, 0);

  await decide(env, reqId, cookie, 'allow');
  assert.equal(env.OAUTH_PROVIDER.calls.completeAuthorization.length, 1);
});

test('POST /callback allow falls back to the sub claim, then to a placeholder, when login is absent', async () => {
  const env = makeEnv();

  const subOnly = jwtWithPayload({ sub: 'github:7', exp: 2000000000 });
  let flow = await startFlow(env);
  await decide(env, flow.reqId, cookies(flow.csrf, `fgs_token=${subOnly}`));
  // The library packs tokens as `userId:grantId:secret`, so the colon in
  // GitHub's `github:<id>` sub must not reach it — unwrapToken() would reject
  // every token minted for this grant. Sanitized for the library...
  assert.equal(env.OAUTH_PROVIDER.calls.completeAuthorization[0].userId, 'github_7');
  // ...while props keeps the REAL identity, which is what the tools' ownership
  // gate compares against the registry's creatorGithub, and metadata.label is
  // display text. Sanitizing either would be a behaviour change.
  assert.equal(env.OAUTH_PROVIDER.calls.completeAuthorization[0].props.userId, 'github:7');
  assert.equal(env.OAUTH_PROVIDER.calls.completeAuthorization[0].metadata.label, 'github:7');

  // An undecodable payload must not throw — the token is still verified, so the
  // grant is real; only the display identity is unknown.
  flow = await startFlow(env);
  await decide(env, flow.reqId, cookies(flow.csrf, 'fgs_token=not.a-valid-payload.sig'));
  assert.equal(env.OAUTH_PROVIDER.calls.completeAuthorization[1].userId, 'user');
});

test('/callback reads fgs_token from a multi-cookie header and ignores lookalike names', async () => {
  const env = makeEnv();
  const { reqId, csrf } = await startFlow(env);

  const res = await decide(
    env,
    reqId,
    cookies('theme=dark', csrf, `fgs_token=${GRACE}`, 'cf_clearance=abc'),
  );
  assert.equal(res.status, 302);
  assert.equal(env.OAUTH_PROVIDER.calls.completeAuthorization[0].props.token, GRACE);
});

test('/callback does not accept a cookie whose name merely ends in fgs_token', async () => {
  const env = makeEnv();
  const { reqId, csrf } = await startFlow(env);

  const res = await decide(env, reqId, cookies(csrf, `x_fgs_token=${GRACE}`));
  assert.equal(res.status, 401);
});

// -- root path: the reconnect / redial contract --

test('GET / with an SSE Accept 405s instead of opening a dead stream', async () => {
  // A 200 with a non-stream body reads to the client as "stream opened, then
  // dropped" and it redials ~1/sec forever. 405 is the wrong-number answer.
  const res = await handler.fetch(get('/', { accept: 'text/event-stream' }), makeEnv());

  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'GET, HEAD');
  const body = await res.json();
  assert.equal(body.jsonrpc, '2.0');
  assert.equal(body.error.code, -32000);
  assert.match(body.error.message, /mcp\.freegamestore\.online\/mcp/);
});

test('POST / (JSON-RPC at the origin) 405s and points at the real endpoint', async () => {
  const res = await handler.fetch(
    new Request(`${ORIGIN}/`, { method: 'POST', body: '{}' }),
    makeEnv(),
  );

  assert.equal(res.status, 405);
  assert.match((await res.json()).error.message, /\/mcp$/);
});

test('GET / from a browser serves the plain-text connect instructions', async () => {
  const res = await handler.fetch(get('/'), makeEnv());

  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/plain/);
  assert.match(await res.text(), /mcp-remote https:\/\/mcp\.freegamestore\.online\/mcp/);
});

test('an unrouted path 404s', async () => {
  const res = await handler.fetch(get('/nope'), makeEnv());
  assert.equal(res.status, 404);
});
