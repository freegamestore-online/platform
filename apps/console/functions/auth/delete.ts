/**
 * Self-service account deletion across console, agent, and auth.
 *
 * Orchestrates deletion of:
 * - Agent D1 session index, per-session Durable Object storage, API keys, comp grants
 * - Auth D1 user record
 * - Console session cookies
 *
 * Returns success only if every step succeeds. The steps run in order and stop
 * at the first failure, and each one is safe to retry, so a failed deletion is
 * finished by trying again.
 */

import { getCookie, SESSION_COOKIE } from '../api/_auth';
import { type DevOriginEnv, rejectCrossSite } from '../api/_csrf';

const AUTH = 'https://auth.freegamestore.online';
const AGENT = 'https://agent.freegamestore.online';

interface Step {
  ok: boolean;
  message?: string;
  error?: string;
}

interface DeleteResult {
  ok: boolean;
  agent?: Step;
  auth?: Step;
  cleared?: boolean;
  error?: string;
}

function respond(result: DeleteResult, status: number, headers = new Headers()): Response {
  headers.set('Content-Type', 'application/json');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(result), { status, headers });
}

/**
 * The agent accepts only its own session audience (#69), not the console's
 * (#483). Trade the console session for an agent session through auth's
 * handoff, the same exchange /auth/agent-handoff runs for the Studio, but
 * redeemed here, server-side, so the agent session never reaches the browser.
 */
async function agentSession(consoleToken: string): Promise<{ token: string } | { status: number }> {
  const issued = await fetch(`${AUTH}/handoff/issue`, {
    method: 'POST',
    headers: { 'X-FGS-Token': consoleToken, 'X-FGS-Handoff-Target': AGENT },
  });
  if (!issued.ok) return { status: issued.status === 401 ? 401 : 502 };
  const handoff = ((await issued.json()) as { token?: string }).token;
  if (!handoff) return { status: 502 };
  const consumed = await fetch(`${AUTH}/handoff/consume`, {
    method: 'POST',
    headers: { 'X-FGS-Handoff': handoff, 'X-FGS-Handoff-Target': AGENT },
  });
  if (!consumed.ok) return { status: 502 };
  const token = ((await consumed.json()) as { token?: string }).token;
  return token ? { token } : { status: 502 };
}

/** DELETE `url` with `token` as the explicit header credential (#485). */
async function deleteAt(url: string, token: string): Promise<Step> {
  try {
    const res = await fetch(url, { method: 'DELETE', headers: { 'X-FGS-Token': token } });
    const body = (await res.json().catch(() => ({}))) as Step;
    if (res.ok && body.ok !== false) return { ...body, ok: true };
    return { ...body, ok: false, error: body.error ?? `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'request failed' };
  }
}

export const onRequestPost: PagesFunction<DevOriginEnv> = async (context) => {
  const crossSite = rejectCrossSite(context.request, {}, context.env);
  if (crossSite) return crossSite;
  const cookie = getCookie(context.request, SESSION_COOKIE);
  if (!cookie) return respond({ ok: false, error: 'Not signed in. Nothing was deleted.' }, 401);

  // 0. An agent session for the agent step. Failing here deletes nothing.
  const session = await agentSession(cookie).catch(() => ({ status: 502 }));
  if (!('token' in session)) {
    return respond(
      {
        ok: false,
        error:
          session.status === 401
            ? 'Your session has expired. Sign in again. Nothing was deleted.'
            : 'Could not reach the sign-in service. Nothing was deleted.',
      },
      session.status,
    );
  }

  // 1. Agent: session transcripts and files, BYO keys, comp grants.
  const result: DeleteResult = { ok: false };
  result.agent = await deleteAt(`${AGENT}/v1/account`, session.token);
  if (!result.agent.ok) {
    result.error = `Could not delete your Studio data (${result.agent.error}). Your account was not deleted; try again.`;
    return respond(result, 502);
  }

  // 2. Auth: the user record. It goes last, so a failure above leaves the
  // account in place to retry with.
  result.auth = await deleteAt(`${AUTH}/account`, cookie);
  if (!result.auth.ok) {
    result.error = `Your Studio data was deleted, but your account record was not (${result.auth.error}). Try again.`;
    return respond(result, 502);
  }

  // 3. Clear session cookies
  const headers = new Headers();
  headers.append(
    'Set-Cookie',
    `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
  );
  headers.append(
    'Set-Cookie',
    'fgs_token=; Domain=.freegamestore.online; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
  );
  result.ok = true;
  result.cleared = true;
  return respond(result, 200, headers);
};
