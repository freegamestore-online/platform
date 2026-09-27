import { getCookie, SESSION_COOKIE } from '../api/_auth';

const AUTH = 'https://auth.freegamestore.online';
const AGENT = 'https://agent.freegamestore.online';

/** Gives the browser a five-minute agent-only handoff, never the console JWT. */
export const onRequestPost: PagesFunction = async (context) => {
  const token = getCookie(context.request, SESSION_COOKIE);
  if (!token) return new Response(JSON.stringify({ error: 'not signed in' }), { status: 401 });
  const issued = await fetch(`${AUTH}/handoff/issue`, {
    method: 'POST',
    headers: { 'X-FGS-Token': token, 'X-FGS-Handoff-Target': AGENT },
  });
  if (!issued.ok)
    return new Response(JSON.stringify({ error: 'could not establish agent session' }), {
      status: 401,
    });
  return new Response(await issued.text(), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};
