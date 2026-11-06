import { describe, expect, it, vi } from 'vitest';
import { routeAdminRequest } from './admin-request-router';
import { handleAdminAuthRoute } from './caller';

const AUTH = 'https://auth.freegamestore.online';
const env = () =>
  ({
    SESSION_SIGNING_KEY: 'k',
    AUTH: { fetch: vi.fn(async () => Response.json({ token: 'session.jwt.value' })) },
  }) as never;

const post = (origin: string | undefined, fields: Record<string, string>, cookie?: string) =>
  new Request('https://admin.freegamestore.online/auth/handoff', {
    method: 'POST',
    headers: { ...(origin ? { Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: new URLSearchParams(fields),
  });

describe('admin /auth/handoff delivery (#450)', () => {
  it('accepts the handoff in a POST body from the auth origin and sets the session cookie', async () => {
    const e = env();
    const res = await handleAdminAuthRoute(
      post(AUTH, { token: 'handoff.jwt', return_to: 'https://admin.freegamestore.online/games' }),
      e,
    );
    expect(res?.status).toBe(302);
    expect(res?.headers.get('location')).toBe('https://admin.freegamestore.online/games');
    expect(res?.headers.get('set-cookie')).toContain('__Host-fgs_token=session.jwt.value');
    const call = (e as { AUTH: { fetch: ReturnType<typeof vi.fn> } }).AUTH.fetch.mock.calls[0]!;
    expect((call[1] as RequestInit).headers).toMatchObject({ 'X-FGS-Handoff': 'handoff.jwt' });
  });

  it('refuses a POST from a game page or without an Origin', async () => {
    for (const origin of ['https://evil.freegamestore.online', undefined]) {
      const res = await handleAdminAuthRoute(post(origin, { token: 'handoff.jwt' }), env());
      expect(res?.status).toBe(400);
    }
  });

  it('the router does not 403 the auth page POST just because a stale session cookie is present', async () => {
    const api = vi.fn(async () => null);
    const auth = vi.fn(async () => new Response('auth'));
    const res = await routeAdminRequest(
      post(AUTH, { token: 'handoff.jwt' }, '__Host-fgs_token=stale'),
      { preflight: () => new Response(), auth, api, static: api },
    );
    expect(await res?.text()).toBe('auth');
  });
});
