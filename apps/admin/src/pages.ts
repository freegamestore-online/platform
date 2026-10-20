import { renderApiDocs } from './dashboard';

/** Sign-in / not-authorized page for the console. `signedInAs` distinguishes a
 *  fresh visitor (null → "sign in") from a signed-in non-admin (→ "wrong
 *  account, switch"). Google login, `prompt=select_account`, redirects back. */
export function renderSignIn(signedInAs: string | null): string {
  // /login/google — NOT /login (that route is GitHub, which yields no email and
  // can never match the admin allowlist). Google carries the verified email.
  const loginUrl =
    'https://auth.freegamestore.online/login/google?redirect=' +
    encodeURIComponent('https://admin.freegamestore.online/');
  const wrong = signedInAs
    ? `<p class="note">Signed in as <strong>${escapeHtml(signedInAs)}</strong> — that account isn't an admin.</p>`
    : `<p class="note">This console is restricted to the store administrator.</p>`;
  const cta = signedInAs ? 'Use a different account' : 'Sign in with Google';
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Sign in — FreeGameStore Admin</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100dvh; display:flex; align-items:center; justify-content:center; padding:1.5rem;
    background:#0d0f0e; color:#e5e5e5; font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif; }
  .card { width:100%; max-width:380px; background:#141715; border:1px solid #262a27; border-radius:16px;
    padding:2.25rem 2rem; text-align:center; }
  .mark { font-family:Fraunces,Georgia,serif; font-weight:800; font-size:1.35rem; letter-spacing:-0.02em; margin-bottom:0.35rem; }
  .mark span { color:#34d399; }
  .sub { color:#8b938d; font-size:0.8rem; margin:0 0 1.6rem; text-transform:uppercase; letter-spacing:0.12em; }
  .note { color:#a8b0aa; font-size:0.9rem; line-height:1.5; margin:0 0 1.6rem; }
  .btn { display:inline-flex; align-items:center; justify-content:center; gap:0.5rem; width:100%;
    background:#34d399; color:#04140d; font-weight:700; font-size:0.95rem; text-decoration:none;
    padding:0.8rem 1rem; border-radius:10px; }
  .btn:hover { background:#2dd4a7; }
</style></head>
<body><main class="card">
  <div class="mark">Free<span>Game</span>Store</div>
  <p class="sub">Admin</p>
  ${wrong}
  <a class="btn" href="${loginUrl}">${cta}</a>
</main></body></html>`;
}

/** Minimal HTML-escape for values interpolated into the sign-in page. */
/** /docs for any method: the API docs page for an admin, the sign-in page for
 *  anyone else. Both are HTML. GET used to send the docs page JSON-encoded, as a
 *  quoted string (#367). */
export function docsPage(caller: { admin: string | null; isAdmin: boolean }): Response {
  if (!caller.isAdmin) {
    return new Response(renderSignIn(caller.admin), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  return new Response(renderApiDocs(), {
    headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' },
  });
}

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
