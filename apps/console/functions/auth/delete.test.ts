import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost } from './delete';

// Account deletion (#113): orchestrates deletion across agent, auth, and clears cookies.
// Success requires both agent and auth to succeed; failure at either step rolls back partially
// with clear error reporting so the user knows what to retry.

let mockFetch: ReturnType<typeof vi.fn>;
let originalFetch: typeof global.fetch;

// Auth's handoff endpoints answer with a token; the deletes with ok.
function okResponse(url: string): Response {
  const body = url.includes('/handoff/')
    ? { token: 'agent.token.here' }
    : { ok: true, message: 'OK' };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  mockFetch = vi.fn().mockImplementation((url: string) => okResponse(url));
  originalFetch = global.fetch;
  (global as unknown as typeof globalThis).fetch = mockFetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

// The Profile page posts same-origin, so the browser attaches this Origin.
const CONSOLE = 'https://console.freegamestore.online';

async function post(
  cookie = '__Host-fgs_token=valid.token.here',
  headers: Record<string, string> = { Origin: CONSOLE },
) {
  const context = {
    request: new Request('https://console.freegamestore.online/auth/delete', {
      method: 'POST',
      headers: { Cookie: cookie, ...headers },
    }),
    env: {},
  };

  // biome-ignore lint/suspicious/noExplicitAny: test context
  const res = await onRequestPost(context as any);
  return { res, mockFetch };
}

describe('POST /auth/delete', () => {
  it('requires an authenticated session', async () => {
    const context = {
      request: new Request('https://console.freegamestore.online/auth/delete', {
        method: 'POST',
        headers: { Cookie: '', Origin: CONSOLE }, // No token
      }),
      env: {},
    };

    // biome-ignore lint/suspicious/noExplicitAny: test context
    const res = await onRequestPost(context as any);
    expect(res.status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('403s a same-site game page posting with the creator cookie; nothing is deleted (#460)', async () => {
    const { res } = await post('__Host-fgs_token=valid.token.here', {
      Origin: 'https://evil-game.freegamestore.online',
    });
    expect(res.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });

  it('403s a cookie-bearing POST that carries neither Origin nor Sec-Fetch-Site (#460)', async () => {
    const { res } = await post('__Host-fgs_token=valid.token.here', {});
    expect(res.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('calls agent and auth deletion endpoints', async () => {
    const { res, mockFetch } = await post();
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://agent.freegamestore.online/v1/account',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      'https://auth.freegamestore.online/account',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('clears session cookies on successful deletion', async () => {
    const { res } = await post();
    expect(res.status).toBe(200);
    const cookies = res.headers.getSetCookie();
    expect(cookies.some((c) => c.includes('__Host-fgs_token') && c.includes('Max-Age=0'))).toBe(
      true,
    );
    const body = (await res.json()) as { ok?: boolean };
    expect(body.ok).toBe(true);
  });

  it('reports failure if agent deletion fails', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('agent')) {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: false, error: 'Agent error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(okResponse(url));
    });

    const context = {
      request: new Request('https://console.freegamestore.online/auth/delete', {
        method: 'POST',
        headers: { Cookie: '__Host-fgs_token=token', Origin: CONSOLE },
      }),
      env: {},
    };

    // biome-ignore lint/suspicious/noExplicitAny: test context
    const res = await onRequestPost(context as any);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { ok?: boolean };
    expect(body.ok).toBe(false);
    // The auth record is kept so the deletion can be retried.
    expect(mockFetch).not.toHaveBeenCalledWith(
      'https://auth.freegamestore.online/account',
      expect.anything(),
    );
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });

  it('sends the agent an agent-audience session, never the console cookie (#483)', async () => {
    const { res } = await post();
    expect(res.status).toBe(200);
    const agentCall = mockFetch.mock.calls.find(
      ([u]) => u === 'https://agent.freegamestore.online/v1/account',
    );
    expect(agentCall?.[1].headers['X-FGS-Token']).toBe('agent.token.here');
    const authCall = mockFetch.mock.calls.find(
      ([u]) => u === 'https://auth.freegamestore.online/account',
    );
    expect(authCall?.[1].headers['X-FGS-Token']).toBe('valid.token.here');
  });

  it('deletes nothing when the session cannot be exchanged (#483)', async () => {
    mockFetch.mockImplementation((url: string) =>
      url.includes('/handoff/issue')
        ? new Response(JSON.stringify({ error: 'not signed in' }), { status: 401 })
        : okResponse(url),
    );
    const { res } = await post();
    expect(res.status).toBe(401);
    expect(mockFetch.mock.calls.every(([, init]) => init.method !== 'DELETE')).toBe(true);
  });

  it('reports failure, not success, when only the auth step fails', async () => {
    mockFetch.mockImplementation((url: string) =>
      url === 'https://auth.freegamestore.online/account'
        ? new Response(JSON.stringify({ ok: false, error: 'db down' }), { status: 500 })
        : okResponse(url),
    );
    const { res } = await post();
    expect(res.status).toBe(502);
    const body = (await res.json()) as { ok: boolean; agent: { ok: boolean }; error: string };
    expect(body.ok).toBe(false);
    expect(body.agent.ok).toBe(true);
    expect(body.error).toMatch(/not deleted|was not/);
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });
});
