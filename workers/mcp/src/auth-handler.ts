/**
 * Default (non-API) handler for the OAuthProvider.
 *
 * Best-practice MCP auth: this server is the OAuth Authorization Server for MCP
 * clients (handled by @cloudflare/workers-oauth-provider), but it does NOT do
 * GitHub OAuth itself. It DELEGATES user sign-in to the platform auth worker
 * (auth.freegamestore.online), which already owns the one configured GitHub
 * app. So the MCP needs no GitHub app of its own and nothing to register.
 *
 * Flow:
 *   /authorize  → parse the MCP client's request, stash it, set a nonce cookie
 *                 bound to it, bounce to the auth worker's /login?redirect=<our
 *                 /callback>
 *   auth worker → GitHub → sends a signed, five-minute handoff to our
 *                 /auth/handoff; this origin alone sets its host-only cookie
 *   GET /callback  → match the nonce cookie against the stashed request, verify
 *                    fgs_token, and render the CONSENT PAGE naming the client
 *                    and the account. Nothing is consumed or minted here.
 *   POST /callback → the user's decision. Same nonce match; the stash is
 *                    consumed either way. `allow` re-verifies fgs_token and
 *                    completeAuthorization()s with it as the props token;
 *                    `deny` sends the client error=access_denied.
 */
import type { AuthRequest, OAuthHelpers } from '@cloudflare/workers-oauth-provider';

interface Env {
  OAUTH_PROVIDER: OAuthHelpers;
  OAUTH_KV: KVNamespace;
  AUTH_BASE: string; // e.g. https://auth.freegamestore.online
  AUTH: Fetcher; // service binding to the auth worker (verify fgs_token via /me)
}

function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie');
  if (!header) return null;
  const m = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * SECURITY: bind /callback to the browser that started /authorize.
 *
 * The reqId travels in the URL only, so without this cookie anyone can drive the
 * callback: an attacker registers a client, starts /authorize, takes their own
 * reqId, and gets a victim to open /callback?reqId=<theirs>. The victim's
 * fgs_token rides along on the top-level navigation, /me verifies it (it is a
 * genuine token), and completeAuthorization mints a grant for the VICTIM's
 * identity delivered to the ATTACKER's redirect_uri. PKCE does not help — the
 * attacker owns the client. @cloudflare/workers-oauth-provider does not bind
 * anything here either: it sets no cookies, and the `state` it round-trips is
 * the client's own, which the attacker chooses. Per its README the consent step
 * is the application's job, and this is that step.
 *
 * Same shape as the auth worker's fgs_oauth_state cookie (workers/auth/src/index.ts).
 * Two deliberate differences:
 *
 *  - `__Host-` prefix. FGS serves user-authored games on *.freegamestore.online,
 *    so a malicious game could otherwise set a `Domain=.freegamestore.online`
 *    cookie and forge this nonce from a sibling subdomain (cookie tossing).
 *    Browsers reject a `__Host-` cookie that carries a Domain attribute, which
 *    closes that. It also forces Secure + Path=/ (localhost is exempt from
 *    Secure, so `wrangler dev` is unaffected).
 *
 *  - SameSite=Lax, not Strict. The return leg reaches us via a redirect chain
 *    that passes through github.com, and Strict cookies are routinely dropped on
 *    the way back from an external IdP — Lax is what the auth worker's own state
 *    cookie uses today and is proven to survive this exact round trip. Lax costs
 *    nothing here: the guarantee is that the attacker cannot SET the victim's
 *    cookie, not that the cookie is withheld on cross-site navigation.
 */
const CSRF_COOKIE_PREFIX = '__Host-mcp_csrf_';
const SESSION_COOKIE = '__Host-fgs_token';
const MCP_ORIGIN = 'https://mcp.freegamestore.online';

/** reqId is echoed back to us in the URL and becomes part of a cookie name, so
 *  keep it to the shape we mint (a v4 UUID) rather than trusting the query. */
const REQ_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function setCsrfCookie(reqId: string, nonce: string): string {
  return `${CSRF_COOKIE_PREFIX}${reqId}=${nonce}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
}

function clearCsrfCookie(reqId: string): string {
  return `${CSRF_COOKIE_PREFIX}${reqId}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/** fgs_token is a JWT; its `login` claim is the GitHub username (sub is github:<id>). */
function decodeLogin(jwt: string): string | undefined {
  try {
    const p = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(p + '==='.slice(0, (4 - (p.length % 4)) % 4))) as {
      login?: string;
      sub?: string;
    };
    return payload.login || payload.sub;
  } catch {
    return undefined;
  }
}

/** The client name and the login both land inside HTML. The client name is
 *  attacker-chosen (registration is open), so escape rather than trust. */
function htmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface Stash {
  req: AuthRequest;
  nonce: string;
}

/**
 * Shared by GET and POST /callback: the reqId must be well-formed, still
 * stashed, and bound to THIS browser by the nonce cookie. With `consume` the
 * stash is deleted before anything else is checked, so whatever happens next
 * that reqId can never be used twice — the POST leg always consumes; the GET
 * leg never does, because rendering the page must not spend the request.
 */
async function loadBoundRequest(
  request: Request,
  env: Env,
  reqId: string | null,
  consume: boolean,
): Promise<Stash | Response> {
  if (!reqId || !REQ_ID_RE.test(reqId))
    return new Response('invalid or expired authorization request', { status: 400 });
  const raw = await env.OAUTH_KV.get(`mcpauthreq:${reqId}`);
  if (!raw) return new Response('invalid or expired authorization request', { status: 400 });
  if (consume) await env.OAUTH_KV.delete(`mcpauthreq:${reqId}`);

  // SECURITY: the nonce cookie proves this browser is the one that started
  // /authorize. Without it, see the CSRF_COOKIE_PREFIX note above — a victim
  // can be walked through someone else's authorization request. A stash
  // written before this check shipped has no nonce, so it fails closed and
  // the client simply reconnects.
  const stash = JSON.parse(raw) as Partial<Stash>;
  const cookieNonce = getCookie(request, `${CSRF_COOKIE_PREFIX}${reqId}`);
  if (!stash.req || !stash.nonce || !cookieNonce || cookieNonce !== stash.nonce) {
    return new Response('authorization request could not be verified — please reconnect', {
      status: 400,
    });
  }
  return stash as Stash;
}

/**
 * SECURITY: verify the token's signature via the auth worker BEFORE trusting
 * any claim from it. decodeLogin() is an unsigned read — without this, a forged
 * fgs_token cookie could set props.userId/login to any GitHub user and bypass
 * the ownership gate. Service binding avoids the same-zone loopback (CF 522).
 */
async function verifySession(
  request: Request,
  env: Env,
): Promise<{ token: string; login: string | undefined } | Response> {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return new Response('sign-in did not complete (no session cookie)', { status: 401 });
  // MCP's own session only — never a handoff or another site's session (#69).
  const verify = await env.AUTH.fetch('https://auth.freegamestore.online/me', {
    headers: { 'X-FGS-Token': token, 'X-FGS-Audience': 'https://mcp.freegamestore.online' },
  });
  if (!verify.ok) return new Response('invalid or expired session token', { status: 401 });
  return { token, login: decodeLogin(token) };
}

/**
 * The consent page. This is the step @cloudflare/workers-oauth-provider leaves
 * to the application: the nonce binding stops a victim being walked through an
 * attacker's request, but not a victim INDUCED to start one — click an
 * attacker's /authorize link while signed in and, without this page, the flow
 * completes silently. Naming the client and the account, and requiring a
 * click, is what turns that into an informed choice.
 *
 * The form POSTs back to /callback. The nonce cookie is SameSite=Lax, so a
 * cross-site form post cannot carry it, which is what binds the decision to
 * this browser without a second token.
 */
function consentPage(reqId: string, clientName: string, login: string): string {
  const client = htmlEscape(clientName);
  const user = htmlEscape(login);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Connect FreeGameStore MCP</title>
  <style>
    body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0f19;color:#e5e7eb}
    main{max-width:440px;padding:32px;border:1px solid #1f2937;border-radius:12px;background:#111827;box-shadow:0 12px 32px rgba(0,0,0,.4)}
    h1{font-size:22px;margin:0 0 12px}
    p{line-height:1.5;margin:0 0 20px;color:#9ca3af}
    strong{color:#f9fafb}
    .actions{display:flex;gap:12px}
    button{flex:1;padding:10px 16px;border-radius:8px;font-weight:700;font-size:15px;cursor:pointer;border:1px solid transparent}
    button.allow{background:#22c55e;color:#052e16}
    button.deny{background:transparent;color:#e5e7eb;border-color:#374151}
  </style>
</head>
<body>
  <main>
    <h1>Connect FreeGameStore MCP</h1>
    <p><strong>${client}</strong> wants to use FreeGameStore MCP tools as <strong>${user}</strong>.</p>
    <p>It will be able to create, edit, and publish games owned by this account.</p>
    <form method="POST" action="/callback">
      <input type="hidden" name="reqId" value="${htmlEscape(reqId)}">
      <div class="actions">
        <button class="deny" type="submit" name="action" value="deny">Cancel</button>
        <button class="allow" type="submit" name="action" value="allow" autofocus>Allow</button>
      </div>
    </form>
  </main>
</body>
</html>`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/auth/handoff' && request.method === 'GET') {
      const handoff = url.searchParams.get('token') ?? '';
      if (!handoff) return new Response('missing session handoff', { status: 400 });
      const exchanged = await env.AUTH.fetch('https://auth.freegamestore.online/handoff/consume', {
        method: 'POST',
        headers: { 'X-FGS-Handoff': handoff, 'X-FGS-Handoff-Target': MCP_ORIGIN },
      });
      if (!exchanged.ok) return new Response('invalid or expired session handoff', { status: 401 });
      const body = (await exchanged.json()) as { token?: string };
      if (!body.token) return new Response('invalid session handoff response', { status: 502 });
      const returnTo = url.searchParams.get('return_to');
      let location = `${MCP_ORIGIN}/`;
      try {
        if (returnTo && new URL(returnTo).origin === MCP_ORIGIN) location = returnTo;
      } catch {
        /* use safe default */
      }
      const headers = new Headers({
        Location: location,
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      });
      headers.append(
        'Set-Cookie',
        `${SESSION_COOKIE}=${body.token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
      );
      headers.append(
        'Set-Cookie',
        'fgs_token=; Domain=.freegamestore.online; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
      );
      return new Response(null, { status: 302, headers });
    }

    // Step 1 — MCP client lands here. Stash its OAuth request, bounce to auth worker.
    if (url.pathname === '/authorize') {
      let oauthReqInfo;
      try {
        oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request);
      } catch {
        // Unknown/stale client (e.g. registered against an older server) — fail
        // gracefully so mcp-remote re-registers instead of seeing a 500.
        return new Response('invalid_client: please reconnect to re-register', { status: 400 });
      }
      if (!oauthReqInfo.clientId) return new Response('invalid_request', { status: 400 });

      // SECURITY: PKCE (S256) is mandatory.
      //
      // @cloudflare/workers-oauth-provider only RUNS PKCE verification when a
      // code_challenge is present, so a client that omits one silently falls back
      // to registered-redirect_uri matching as the only protection on the
      // authorization code. That is an absence rather than an error, so nothing
      // upstream reports it. Reject here, before anything is stashed, so the 400
      // costs no cleanup. PAGS and PAS both hard-400 the same way.
      //
      // Note the method check covers the ABSENT case too: parseAuthRequest
      // defaults code_challenge_method to "plain" (never undefined), and plain
      // lets anyone who observes the authorization URL replay the verifier.
      // Checking `!== 'S256'` therefore rejects both `plain` and omitted.
      //
      // Done here rather than via the provider's own `allowPlainPKCE: false`
      // option: that makes parseAuthRequest THROW, and the catch above turns any
      // throw into "invalid_client: please reconnect to re-register" — a
      // misleading message for what is actually a malformed PKCE request.
      if (!oauthReqInfo.codeChallenge) {
        return new Response('code_challenge required (PKCE S256)', { status: 400 });
      }
      if (oauthReqInfo.codeChallengeMethod !== 'S256') {
        return new Response('code_challenge_method must be S256', { status: 400 });
      }

      const reqId = crypto.randomUUID();
      const nonce = crypto.randomUUID();
      await env.OAUTH_KV.put(`mcpauthreq:${reqId}`, JSON.stringify({ req: oauthReqInfo, nonce }), {
        expirationTtl: 600,
      });

      const callback = new URL('/callback', url.origin);
      callback.searchParams.set('reqId', reqId);

      const login = new URL('/login', env.AUTH_BASE);
      login.searchParams.set('redirect', callback.toString());
      // Manual Response rather than Response.redirect() — the latter returns
      // immutable headers, so Set-Cookie cannot be attached.
      return new Response(null, {
        status: 302,
        headers: { Location: login.toString(), 'Set-Cookie': setCsrfCookie(reqId, nonce) },
      });
    }

    // Step 2 — back from the auth worker with the fgs_token cookie set. Show
    // the consent page; nothing is consumed or minted on this leg.
    if (url.pathname === '/callback' && request.method === 'GET') {
      const reqId = url.searchParams.get('reqId');
      const stash = await loadBoundRequest(request, env, reqId, false);
      if (stash instanceof Response) return stash;

      const session = await verifySession(request, env);
      if (session instanceof Response) return session;

      // The registration can vanish between /authorize and here (KV TTL, a
      // redeploy that rotated the client store). Fail closed rather than show
      // a page that names nobody — and spend the stash so it is not retried.
      const client = await env.OAUTH_PROVIDER.lookupClient(stash.req.clientId);
      if (!client) {
        await env.OAUTH_KV.delete(`mcpauthreq:${reqId}`);
        return new Response('invalid_client: please reconnect to re-register', {
          status: 400,
          headers: { 'Set-Cookie': clearCsrfCookie(reqId as string) },
        });
      }

      return new Response(
        consentPage(
          reqId as string,
          client.clientName || 'your MCP client',
          session.login ?? 'FreeGameStore user',
        ),
        {
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
          },
        },
      );
    }

    // Step 3 — the user's decision. The stash is consumed whichever way it goes.
    if (url.pathname === '/callback' && request.method === 'POST') {
      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        return new Response('invalid_request', { status: 400 });
      }
      const reqId = form.get('reqId');
      const action = form.get('action');
      const stash = await loadBoundRequest(
        request,
        env,
        typeof reqId === 'string' ? reqId : null,
        true,
      );
      if (stash instanceof Response) return stash;
      const oauthReqInfo = stash.req;

      if (action === 'deny') {
        // OAuth 2.1 §4.1.2.1: the client learns the user said no via its own
        // redirect_uri. parseAuthRequest already matched that URI against the
        // registration, so this is not an open redirect. No grant exists.
        const back = new URL(oauthReqInfo.redirectUri);
        back.searchParams.set('error', 'access_denied');
        if (oauthReqInfo.state) back.searchParams.set('state', oauthReqInfo.state);
        return new Response(null, {
          status: 302,
          headers: { Location: back.toString(), 'Set-Cookie': clearCsrfCookie(reqId as string) },
        });
      }
      if (action !== 'allow') return new Response('invalid_request', { status: 400 });

      // Re-verify on the decision leg: the GET's check proves nothing about
      // this request, and the session may have expired in between.
      const session = await verifySession(request, env);
      if (session instanceof Response) return session;
      const { token: fgsToken, login } = session;

      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: oauthReqInfo,
        // SECURITY/CORRECTNESS: the library packs tokens as
        // `userId:grantId:secret` and unwrapToken() rejects anything that does
        // not split into exactly 3 parts — so a colon here makes EVERY token
        // minted for this grant unparseable, not merely malformed. Every MCP
        // call then 401s with nothing pointing at the cause.
        //
        // decodeLogin() falls back to the JWT `sub`, and GitHub's sub is
        // `github:<id>`. Currently shadowed (the GitHub mint always sets a
        // `login` claim, and Google's sub is numeric), so this is latent rather
        // than live — but the fallback is deliberately retained and pinned by
        // test, so sanitize defensively as PAGS does.
        //
        // Only the library-facing userId is sanitized. `metadata.label` is
        // display text and `props.userId` is what the tools' ownership gate
        // compares against the registry's creatorGithub — rewriting either
        // would be a behaviour change.
        userId: (login ?? 'user').replace(/:/g, '_'),
        scope: oauthReqInfo.scope ?? [],
        metadata: { label: login ?? 'FreeGameStore user' },
        // props reach the MCP tools as this.props
        props: { token: fgsToken, userId: login },
      });
      // The nonce has done its job — expire it rather than leaving one dead
      // cookie per authorization behind in the browser.
      return new Response(null, {
        status: 302,
        headers: { Location: redirectTo, 'Set-Cookie': clearCsrfCookie(reqId as string) },
      });
    }

    if (url.pathname === '/' || url.pathname === '') {
      // A client pointed at the origin instead of /mcp sends either
      // `GET / Accept: text/event-stream` (SSE transport) or a JSON-RPC POST.
      // Answering 200 with a non-stream body reads as "stream opened, then
      // dropped" and the client redials ~1/sec forever. 405 is the "wrong
      // number" that stops the redial. OPTIONS/HEAD fall through so CORS
      // preflight is unaffected.
      const wantsStream = (request.headers.get('accept') ?? '').includes('text/event-stream');
      if (wantsStream || request.method === 'POST') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: {
              code: -32000,
              message:
                'Method Not Allowed - the MCP endpoint is https://mcp.freegamestore.online/mcp',
            },
          }),
          { status: 405, headers: { 'content-type': 'application/json', allow: 'GET, HEAD' } },
        );
      }
      return new Response(
        'FreeGameStore MCP\nConnect: npx mcp-remote https://mcp.freegamestore.online/mcp\nSign-in is delegated to auth.freegamestore.online.\n',
        { headers: { 'content-type': 'text/plain' } },
      );
    }

    return new Response('Not found', { status: 404 });
  },
};
