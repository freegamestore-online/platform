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
 *   auth worker → GitHub → sets the fgs_token cookie on .freegamestore.online,
 *                 redirects back to our /callback (a subdomain, so it gets the
 *                 cookie)
 *   /callback   → match the nonce cookie against the stashed request, read
 *                 fgs_token, completeAuthorization() with it as the props
 *                 token, redirect the client back with its code
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

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

    // Step 2 — back from the auth worker with the fgs_token cookie set.
    if (url.pathname === '/callback') {
      const reqId = url.searchParams.get('reqId');
      if (!reqId || !REQ_ID_RE.test(reqId))
        return new Response('invalid or expired authorization request', { status: 400 });
      const raw = await env.OAUTH_KV.get(`mcpauthreq:${reqId}`);
      if (!raw) return new Response('invalid or expired authorization request', { status: 400 });
      // Consume the request before validating anything else: whatever happens
      // next, this reqId must never be usable twice.
      await env.OAUTH_KV.delete(`mcpauthreq:${reqId}`);

      // SECURITY: the nonce cookie proves this browser is the one that started
      // /authorize. Without it, see the CSRF_COOKIE_PREFIX note above — a victim
      // can be walked through someone else's authorization request. A stash
      // written before this check shipped has no nonce, so it fails closed and
      // the client simply reconnects.
      const stash = JSON.parse(raw) as { req?: AuthRequest; nonce?: string };
      const cookieNonce = getCookie(request, `${CSRF_COOKIE_PREFIX}${reqId}`);
      if (!stash.nonce || !cookieNonce || cookieNonce !== stash.nonce) {
        return new Response('authorization request could not be verified — please reconnect', {
          status: 400,
        });
      }

      const fgsToken = getCookie(request, 'fgs_token');
      if (!fgsToken)
        return new Response('sign-in did not complete (no session cookie)', { status: 401 });

      // SECURITY: verify the token's signature via the auth worker BEFORE trusting
      // any claim from it. decodeLogin() is an unsigned read — without this, a forged
      // fgs_token cookie could set props.userId/login to any GitHub user and bypass
      // the ownership gate. Service binding avoids the same-zone loopback (CF 522).
      const verify = await env.AUTH.fetch('https://auth.freegamestore.online/me', {
        headers: { 'X-FGS-Token': fgsToken },
      });
      if (!verify.ok) return new Response('invalid or expired session token', { status: 401 });
      const login = decodeLogin(fgsToken);

      const oauthReqInfo = stash.req as AuthRequest;
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
        headers: { Location: redirectTo, 'Set-Cookie': clearCsrfCookie(reqId) },
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
