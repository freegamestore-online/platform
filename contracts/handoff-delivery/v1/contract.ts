/**
 * How a signed handoff travels from the auth worker to a receiving site (#450).
 *
 * It used to be a `?token=` query string on a 302, which puts the token in browser
 * history, proxy and access logs and (before no-referrer) Referer headers. It now
 * rides in the body of a form POST that the auth worker's page submits, so it
 * never appears in a URL.
 *
 *  - auth builds the page with `handoffFormPage` (an auto-submitting form, under
 *    a CSP that allows only that one script and posts only to the target);
 *  - the receiver reads it with `readHandoff`, which accepts the POST only when
 *    its Origin is the one expected sender, so a game page cannot post a token of
 *    its own choosing to sign the player in as someone else.
 *
 * FGS-internal.
 */

export const AUTH_ORIGIN = 'https://auth.freegamestore.online';

const SUBMIT_SCRIPT = 'document.forms[0].submit()';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function sha256Base64(text: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
  );
  let binary = '';
  for (const b of digest) binary += String.fromCharCode(b);
  return btoa(binary);
}

/**
 * A 200 page that POSTs `token` and `return_to` to `${target}/auth/handoff`.
 * Referrer-Policy `origin` (not no-referrer, which makes the browser send
 * `Origin: null` on a cross-origin form POST) so the receiver can check the
 * sender; the policy still strips path and query from the Referer.
 */
export async function handoffFormPage(
  target: string,
  token: string,
  returnTo: string,
  extraHeaders: Headers = new Headers(),
): Promise<Response> {
  const action = `${target}/auth/handoff`;
  const html = `<!doctype html><meta charset="utf-8"><title>Signing in</title>
<form method="post" action="${escapeHtml(action)}">
<input type="hidden" name="token" value="${escapeHtml(token)}">
<input type="hidden" name="return_to" value="${escapeHtml(returnTo)}">
<noscript><button type="submit">Continue</button></noscript>
</form>
<script>${SUBMIT_SCRIPT}</script>
`;
  const hash = await sha256Base64(SUBMIT_SCRIPT);
  extraHeaders.set('Content-Type', 'text/html; charset=utf-8');
  extraHeaders.set('Cache-Control', 'no-store');
  extraHeaders.set('Referrer-Policy', 'origin');
  extraHeaders.set(
    'Content-Security-Policy',
    `default-src 'none'; script-src 'sha256-${hash}'; form-action ${target}; frame-ancestors 'none'`,
  );
  return new Response(html, { status: 200, headers: extraHeaders });
}

export interface Handoff {
  token: string;
  returnTo: string | null;
}

/**
 * Reads the handoff from a request to `/auth/handoff`.
 *  - POST (form body): accepted only from `senderOrigin`.
 *  - GET (`?token=`): the old delivery, kept only while auth still redirects that
 *    way; `allowLegacyGet` is removed once it does not.
 * Returns null when there is no token or the sender is wrong.
 */
export async function readHandoff(
  request: Request,
  senderOrigin: string,
  allowLegacyGet = false,
): Promise<Handoff | null> {
  if (request.method === 'POST') {
    if (request.headers.get('Origin') !== senderOrigin) return null;
    const form = await request.formData().catch(() => null);
    const token = form?.get('token');
    const returnTo = form?.get('return_to');
    if (typeof token !== 'string' || !token) return null;
    return { token, returnTo: typeof returnTo === 'string' ? returnTo : null };
  }
  if (request.method === 'GET' && allowLegacyGet) {
    const url = new URL(request.url);
    const token = url.searchParams.get('token');
    return token ? { token, returnTo: url.searchParams.get('return_to') } : null;
  }
  return null;
}
