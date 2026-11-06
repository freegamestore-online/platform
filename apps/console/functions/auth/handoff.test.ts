import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequestGet, onRequestPost } from './handoff';

const AUTH = 'https://auth.freegamestore.online';
let mockFetch: ReturnType<typeof vi.fn>;
let original: typeof global.fetch;
beforeEach(() => {
  mockFetch = vi.fn(async () => Response.json({ token: 'console.session.jwt' }));
  original = global.fetch;
  (global as unknown as typeof globalThis).fetch = mockFetch;
});
afterEach(() => {
  global.fetch = original;
});

const run = (fn: typeof onRequestPost, request: Request) =>
  // biome-ignore lint/suspicious/noExplicitAny: test context
  fn({ request, env: {} } as any) as Promise<Response>;

const post = (origin: string | undefined, fields: Record<string, string>) =>
  new Request('https://console.freegamestore.online/auth/handoff', {
    method: 'POST',
    headers: origin ? { Origin: origin } : {},
    body: new URLSearchParams(fields),
  });

describe('console /auth/handoff delivery (#450)', () => {
  it('takes the handoff from a POST body sent by the auth origin', async () => {
    const res = await run(
      onRequestPost,
      post(AUTH, {
        token: 'handoff.jwt',
        return_to: 'https://console.freegamestore.online/profile',
      }),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://console.freegamestore.online/profile');
    expect(res.headers.get('set-cookie')).toContain('__Host-fgs_token=console.session.jwt');
    expect(mockFetch.mock.calls[0]![1].headers['X-FGS-Handoff']).toBe('handoff.jwt');
  });

  it('refuses a POST from a game, from nowhere, or with no token', async () => {
    for (const request of [
      post('https://evil.freegamestore.online', { token: 'handoff.jwt' }),
      post(undefined, { token: 'handoff.jwt' }),
      post(AUTH, {}),
    ]) {
      expect((await run(onRequestPost, request)).status).toBe(400);
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('ignores a return_to on another origin', async () => {
    const res = await run(
      onRequestPost,
      post(AUTH, { token: 't', return_to: 'https://evil.test/' }),
    );
    expect(res.headers.get('location')).toBe('https://console.freegamestore.online');
  });

  it('still accepts the legacy GET ?token= until auth stops sending it', async () => {
    const res = await run(
      onRequestGet,
      new Request('https://console.freegamestore.online/auth/handoff?token=handoff.jwt'),
    );
    expect(res.status).toBe(302);
  });
});
