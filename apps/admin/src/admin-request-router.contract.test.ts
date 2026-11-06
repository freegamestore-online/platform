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
  it('trusts localhost:5173 for cookie mutations only when DEV_ORIGIN names it (#486)', async () => {
    const devReq = () =>
      new Request('https://admin.test/api/comp', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:5173',
          Cookie: '__Host-fgs_token=t',
          'Content-Type': 'application/json',
        },
        body: '{}',
      });
    const prod = handlers();
    expect((await routeAdminRequest(devReq(), prod))?.status).toBe(403);
    expect(prod.api).not.toHaveBeenCalled();
    const dev = handlers();
    await routeAdminRequest(devReq(), dev, 'http://localhost:5173');
    expect(dev.api).toHaveBeenCalled();
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

// #489: workerd gives a body-less POST a non-null `request.body`, so the old
// `request.body !== null` gate answered 415 to every body-less admin call.
describe('body-less mutations', () => {
  const noBody = (method: string, headers: Record<string, string> = {}) =>
    new Request('https://admin.test/api/games/test/heal-route', {
      method,
      headers: { 'Content-Length': '0', ...headers },
    });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'lets a body-less %s through (CLI token)',
    async (method) => {
      const h = handlers();
      await routeAdminRequest(noBody(method, { 'X-FGS-Token': 't' }), h);
      expect(h.api).toHaveBeenCalled();
    },
  );

  it('lets a body-less same-origin cookie POST through', async () => {
    const h = handlers();
    await routeAdminRequest(
      noBody('POST', {
        Cookie: '__Host-fgs_token=t',
        Origin: 'https://admin.freegamestore.online',
      }),
      h,
    );
    expect(h.api).toHaveBeenCalled();
  });

  it('still blocks a body-less cross-site cookie POST', async () => {
    const h = handlers();
    const res = await routeAdminRequest(
      noBody('POST', { Cookie: '__Host-fgs_token=t', Origin: 'https://evil.freegamestore.online' }),
      h,
    );
    expect(res?.status).toBe(403);
  });

  it('still 415s a non-JSON body on a token-authenticated request', async () => {
    const h = handlers();
    const res = await routeAdminRequest(
      new Request('https://admin.test/api/comp', {
        method: 'POST',
        headers: { 'X-FGS-Token': 't', 'Content-Type': 'text/plain', 'Content-Length': '2' },
        body: '{}',
      }),
      h,
    );
    expect(res?.status).toBe(415);
    expect(h.api).not.toHaveBeenCalled();
  });
});
