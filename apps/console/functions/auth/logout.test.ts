import { describe, expect, it, vi } from 'vitest';
import { onRequestPost } from './logout';

// Regression for #71: Sign out left the console's host-only session cookie in
// place, so /auth/me kept resolving the user. Only this origin can clear it.

function call(cookie?: string) {
  const del = vi.fn(async () => {});
  const request = new Request('https://console.freegamestore.online/auth/logout', {
    method: 'POST',
    headers: cookie ? { Cookie: cookie } : {},
  });
  const context = { request, env: { SESSIONS: { delete: del } } } as unknown as Parameters<
    typeof onRequestPost
  >[0];
  return { res: onRequestPost(context) as Promise<Response>, del };
}

describe('POST /auth/logout', () => {
  it('expires the __Host- session cookie with a separate Set-Cookie header', async () => {
    const { res } = call('__Host-fgs_token=abc.def.ghi');
    const response = await res;
    expect(response.status).toBe(204);
    const cookies = response.headers.getSetCookie();
    const session = cookies.find((c) => c.startsWith('__Host-fgs_token=;'));
    expect(session).toBeDefined();
    expect(session).toMatch(/Max-Age=0/);
    expect(session).toMatch(/Path=\//);
    expect(session).toMatch(/Secure/);
    // A Domain attribute would make browsers reject the __Host- cookie update.
    expect(session).not.toMatch(/Domain=/i);
  });

  it('retires a legacy publisher session (KV entry and cookie)', async () => {
    const { res, del } = call('fgs_pub_session=legacy123; __Host-fgs_token=t');
    const response = await res;
    expect(del).toHaveBeenCalledWith('sessions:legacy123');
    const legacy = response.headers.getSetCookie().find((c) => c.startsWith('fgs_pub_session=;'));
    expect(legacy).toMatch(/Domain=\.freegamestore\.online/);
    expect(legacy).toMatch(/Max-Age=0/);
  });

  it('still clears cookies when there is no legacy session to delete', async () => {
    const { res, del } = call();
    const response = await res;
    expect(del).not.toHaveBeenCalled();
    expect(response.headers.getSetCookie()).toHaveLength(2);
  });
});
