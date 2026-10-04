/**
 * Self-service account deletion across console, agent, and auth.
 *
 * Orchestrates deletion of:
 * - Agent D1 session index, per-session Durable Object storage, API keys, comp grants
 * - Auth D1 user record
 * - Console session cookies
 *
 * Returns success only if every step succeeds. If any step fails, the user is notified
 * but may need manual cleanup (though partial deletion is unlikely given the order).
 */

interface DeleteResult {
  ok: boolean;
  agent?: { ok: boolean; message?: string; error?: string };
  auth?: { ok: boolean; message?: string; error?: string };
  cleared?: boolean;
  error?: string;
}

function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie') ?? '';
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? match[1] : null;
}

export const onRequestPost: PagesFunction = async (context) => {
  const cookie = getCookie(context.request, '__Host-fgs_token');

  if (!cookie) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'Not signed in. Nothing was deleted.',
      }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      },
    );
  }

  const result: DeleteResult = { ok: false };

  try {
    // 1. Delete from agent (sessions, keys, comp grants)
    try {
      const agentResp = await fetch('https://agent.freegamestore.online/v1/account', {
        method: 'DELETE',
        headers: {
          'X-FGS-Token': cookie,
          'Content-Type': 'application/json',
        },
      });
      const agentData = (await agentResp.json()) as {
        ok?: boolean;
        message?: string;
        error?: string;
      };
      result.agent = agentData;
      if (!agentResp.ok) {
        return new Response(JSON.stringify(result), {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        });
      }
    } catch (e) {
      result.agent = {
        ok: false,
        error: e instanceof Error ? e.message : 'Agent deletion failed',
      };
      return new Response(JSON.stringify(result), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    // 2. Delete from auth (user record)
    try {
      const authResp = await fetch('https://auth.freegamestore.online/account', {
        method: 'DELETE',
        headers: {
          'X-FGS-Token': cookie,
          'Content-Type': 'application/json',
        },
      });
      const authData = (await authResp.json()) as {
        ok?: boolean;
        message?: string;
        error?: string;
      };
      result.auth = authData;
      if (!authResp.ok) {
        return new Response(JSON.stringify(result), {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        });
      }
    } catch (e) {
      result.auth = {
        ok: false,
        error: e instanceof Error ? e.message : 'Auth deletion failed',
      };
      return new Response(JSON.stringify(result), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    // 3. Clear session cookies
    const headers = new Headers({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    headers.append(
      'Set-Cookie',
      '__Host-fgs_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
    );
    headers.append(
      'Set-Cookie',
      'fgs_token=; Domain=.freegamestore.online; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
    );

    result.ok = true;
    result.cleared = true;

    return new Response(JSON.stringify(result), { status: 200, headers });
  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Account deletion failed';
    return new Response(JSON.stringify(result), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
};
