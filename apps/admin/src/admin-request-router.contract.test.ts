import { describe, expect, it, vi } from 'vitest';
import { routeAdminRequest } from './admin-request-router';

function handlers() {
  return {
    preflight: vi.fn(() => new Response('preflight')),
    auth: vi.fn(async () => new Response('auth')),
    api: vi.fn(async () => new Response('api')),
    static: vi.fn(async () => new Response('static')),
  };
}

describe('admin request router contract', () => {
  it('keeps CORS preflight outside auth and data handling', async () => {
    const h = handlers();
    const response = await routeAdminRequest(
      new Request('https://admin.test/api/status', { method: 'OPTIONS' }),
      h,
    );
    expect(await response?.text()).toBe('preflight');
    expect(h.auth).not.toHaveBeenCalled();
    expect(h.api).not.toHaveBeenCalled();
  });

  it('routes handoff and CLI auth before API dispatch', async () => {
    const h = handlers();
    const response = await routeAdminRequest(new Request('https://admin.test/v1/auth/me'), h);
    expect(await response?.text()).toBe('auth');
    expect(h.api).not.toHaveBeenCalled();
    expect(h.static).not.toHaveBeenCalled();
  });

  it('separates API and static route domains while retaining docs as a rendered API resource', async () => {
    const h = handlers();
    await routeAdminRequest(new Request('https://admin.test/api/status'), h);
    await routeAdminRequest(new Request('https://admin.test/docs'), h);
    await routeAdminRequest(new Request('https://admin.test/assets/app.js'), h);
    expect(h.api).toHaveBeenCalledTimes(2);
    expect(h.static).toHaveBeenCalledTimes(1);
  });
});

describe('mutation guards', () => {
  it.each([
    '/api/comp',
    '/api/userkey',
    '/api/sessionchat',
    '/api/provision',
    '/api/games/test/heal-route',
  ])('blocks game-origin cookie mutations at %s', async (path) => {
    const h = handlers();
    const response = await routeAdminRequest(
      new Request(`https://admin.test${path}`, {
        method: 'POST',
        headers: { Cookie: '__Host-fgs_token=t', Origin: 'https://evil.freegamestore.online' },
        body: '{}',
      }),
      h,
    );
    expect(response?.status).toBe(403);
    expect(h.api).not.toHaveBeenCalled();
  });
  it('requires origin evidence for cookies', async () => {
    const response = await routeAdminRequest(
      new Request('https://admin.test/api/comp', {
        method: 'POST',
        headers: { Cookie: '__Host-fgs_token=t', 'Content-Type': 'application/json' },
        body: '{}',
      }),
      handlers(),
    );
    expect(response?.status).toBe(403);
  });
  it.each<Record<string, string>>([
    { Origin: 'https://admin.freegamestore.online', Cookie: '__Host-fgs_token=t' },
    { 'Sec-Fetch-Site': 'same-origin', Cookie: '__Host-fgs_token=t' },
    { 'X-FGS-Token': 't' },
    { Authorization: 'Bearer t' },
  ])('accepts trusted mutation transport %j', async (headers) => {
    const h = handlers();
    await routeAdminRequest(
      new Request('https://admin.test/api/comp', {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: '{}',
      }),
      h,
    );
    expect(h.api).toHaveBeenCalled();
  });
  it('rejects text bodies even from the admin origin', async () => {
    const response = await routeAdminRequest(
      new Request('https://admin.test/api/comp', {
        method: 'POST',
        headers: { Origin: 'https://admin.freegamestore.online', Cookie: '__Host-fgs_token=t' },
        body: '{}',
      }),
      handlers(),
    );
    expect(response?.status).toBe(415);
  });
});
