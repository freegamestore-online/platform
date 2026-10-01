import { SESSION_COOKIE, type SessionEnv } from '../api/_auth';

const LEGACY_COOKIE = 'fgs_pub_session';

function getCookie(request: Request, name: string): string | null {
  const match = (request.headers.get('Cookie') ?? '').match(
    new RegExp(`(?:^|;\\s*)${name}=([^;]*)`),
  );
  return match?.[1] ?? null;
}

/**
 * Ends the console session. The session is the host-only `__Host-fgs_token`
 * cookie written by /auth/handoff on this origin, so only this origin can clear
 * it — the auth worker's /logout cannot (#71). Also retires the legacy publisher
 * session, which resolveCreatorUser would otherwise still honour.
 */
export const onRequestPost: PagesFunction<SessionEnv> = async (context) => {
  const legacy = getCookie(context.request, LEGACY_COOKIE);
  if (legacy) {
    try {
      await context.env.SESSIONS.delete(`sessions:${legacy}`);
    } catch {
      // Best-effort: the cookie is still expired below.
    }
  }

  const headers = new Headers({ 'Cache-Control': 'no-store' });
  headers.append(
    'Set-Cookie',
    `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
  );
  headers.append(
    'Set-Cookie',
    `${LEGACY_COOKIE}=; Domain=.freegamestore.online; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
  );
  return new Response(null, { status: 204, headers });
};
