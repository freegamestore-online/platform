import { SESSION_COOKIE } from '../api/_auth';

interface Env {
  JWT_SECRET?: string;
}

const AUTH = 'https://auth.freegamestore.online';
const TARGET = 'https://console.freegamestore.online';

function safeReturn(raw: string | null): string {
  try {
    const url = new URL(raw ?? TARGET);
    return url.origin === TARGET ? url.toString() : TARGET;
  } catch {
    return TARGET;
  }
}

/** Completes auth's signed handoff and writes a console-only session cookie. */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const handoff = url.searchParams.get('token') ?? '';
  if (!handoff) return new Response('missing session handoff', { status: 400 });
  const exchanged = await fetch(`${AUTH}/handoff/consume`, {
    method: 'POST',
    headers: { 'X-FGS-Handoff': handoff, 'X-FGS-Handoff-Target': TARGET },
  });
  if (!exchanged.ok) return new Response('invalid or expired session handoff', { status: 401 });
  const body = (await exchanged.json()) as { token?: string };
  if (!body.token) return new Response('invalid session handoff response', { status: 502 });
  const headers = new Headers({
    Location: safeReturn(url.searchParams.get('return_to')),
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
};
