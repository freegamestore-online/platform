import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost } from './delete';

// Account deletion (#113): orchestrates deletion across agent, auth, and clears cookies.
// Success requires both agent and auth to succeed; failure at either step rolls back partially
// with clear error reporting so the user knows what to retry.

let mockFetch: ReturnType<typeof vi.fn>;
let originalFetch: typeof global.fetch;

beforeEach(() => {
  mockFetch = vi.fn().mockImplementation(
    () =>
      new Response(JSON.stringify({ ok: true, message: 'OK' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  originalFetch = global.fetch;
  (global as any).fetch = mockFetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

// biome-ignore lint/suspicious/noExplicitAny: test context parameter
async function post(cookie = '__Host-fgs_token=valid.token.here') {
  const context = {
    request: new Request('https://console.freegamestore.online/auth/delete', {
      method: 'POST',
      headers: { Cookie: cookie },
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
        headers: { Cookie: '' }, // No token
      }),
      env: {},
    };

    // biome-ignore lint/suspicious/noExplicitAny: test context
    const res = await onRequestPost(context as any);
    expect(res.status).toBe(401);
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
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    });

    const context = {
      request: new Request('https://console.freegamestore.online/auth/delete', {
        method: 'POST',
        headers: { Cookie: '__Host-fgs_token=token' },
      }),
      env: {},
    };

    // biome-ignore lint/suspicious/noExplicitAny: test context
    const res = await onRequestPost(context as any);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { ok?: boolean };
    expect(body.ok).toBe(false);
  });
});
