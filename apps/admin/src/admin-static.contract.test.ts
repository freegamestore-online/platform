import { describe, expect, it, vi } from 'vitest';
import { serveAdminStatic } from './admin-static';

describe('admin static boundary contract', () => {
  it('serves the retiring service worker without auth so broken clients can recover', async () => {
    const authenticate = vi.fn();
    const assets = {
      fetch: vi.fn().mockResolvedValue(
        new Response('self.registration.unregister()', {
          headers: { 'Content-Type': 'application/javascript' },
        }),
      ),
    } as unknown as Fetcher;

    const response = await serveAdminStatic(new Request('https://admin.test/sw.js'), {
      authenticate,
      renderSignIn: () => 'unused',
      assets,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/javascript');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Service-Worker-Allowed')).toBe('/');
    expect(await response.text()).toContain('unregister');
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('does not ask the assets binding to serve an unauthorised request', async () => {
    const assets = { fetch: vi.fn() } as unknown as Fetcher;
    const response = await serveAdminStatic(new Request('https://admin.test/'), {
      authenticate: async () => ({ email: null, isAdmin: false }),
      renderSignIn: () => '<h1>Sign in</h1>',
      assets,
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Sign in');
    expect(assets.fetch).not.toHaveBeenCalled();
  });

  it('falls back to the app shell when a permitted static asset is missing', async () => {
    const assets = {
      fetch: vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 404 }))
        .mockResolvedValueOnce(new Response('shell')),
    } as unknown as Fetcher;
    const response = await serveAdminStatic(new Request('https://admin.test/games/one'), {
      authenticate: async () => ({ email: 'admin@example.test', isAdmin: true }),
      renderSignIn: () => 'unused',
      assets,
    });
    expect(await response.text()).toBe('shell');
    expect(assets.fetch).toHaveBeenCalledTimes(2);
  });
});
