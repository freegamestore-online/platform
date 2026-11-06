import { describe, expect, it } from 'vitest';
import { rejectCrossSite } from './_csrf';

// Same-site CSRF guard (#460). Games live on sibling subdomains — the same
// site as the console — so SameSite=Lax never withholds the creator's cookie
// from them. A state-changing request must therefore prove it came from a
// first-party page: a first-party Origin, or no Origin plus the browser's own
// Sec-Fetch-Site: same-origin. Bodies must be JSON so a preflight-free
// text/plain POST never reaches a handler.

const CONSOLE = 'https://console.freegamestore.online';
const GAME = 'https://evil-game.freegamestore.online';

function req(method: string, headers: Record<string, string>, body?: string): Request {
  return new Request(`${CONSOLE}/auth/delete`, { method, headers, body });
}

describe('rejectCrossSite — allowed', () => {
  it('lets a body-less POST through from the console origin', () => {
    expect(rejectCrossSite(req('POST', { Origin: CONSOLE }))).toBeNull();
  });

  it('lets the storefront origin through (its analytics page PUTs with the cookie)', () => {
    expect(
      rejectCrossSite(
        req(
          'PUT',
          { Origin: 'https://freegamestore.online', 'Content-Type': 'application/json' },
          '{}',
        ),
      ),
    ).toBeNull();
  });

  it('lets the local dev origin through', () => {
    expect(rejectCrossSite(req('POST', { Origin: 'http://localhost:5173' }))).toBeNull();
  });

  it('accepts a JSON body, with or without a charset parameter', () => {
    expect(
      rejectCrossSite(req('POST', { Origin: CONSOLE, 'Content-Type': 'application/json' }, '{}')),
    ).toBeNull();
    expect(
      rejectCrossSite(
        req('PATCH', { Origin: CONSOLE, 'Content-Type': 'Application/JSON; charset=utf-8' }, '{}'),
      ),
    ).toBeNull();
  });

  it('without an Origin, trusts the browser saying the request is same-origin', () => {
    expect(rejectCrossSite(req('POST', { 'Sec-Fetch-Site': 'same-origin' }))).toBeNull();
  });

  it('never gates safe methods', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(rejectCrossSite(req(method, { Origin: GAME }))).toBeNull();
      expect(rejectCrossSite(req(method, {}))).toBeNull();
    }
  });
});

describe('rejectCrossSite — rejected', () => {
  it('403s a POST from a game subdomain, even with a JSON body', async () => {
    const res = rejectCrossSite(
      req('POST', { Origin: GAME, 'Content-Type': 'application/json' }, '{}'),
    );
    expect(res?.status).toBe(403);
    expect(((await res!.json()) as { error: string }).error).toBe('forbidden origin');
  });

  it('403s every non-safe method from a foreign origin', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(rejectCrossSite(req(method, { Origin: 'https://evil.example' }))?.status).toBe(403);
    }
  });

  it('403s a request with neither Origin nor Sec-Fetch-Site (fails closed)', () => {
    expect(rejectCrossSite(req('POST', {}))?.status).toBe(403);
    expect(rejectCrossSite(req('DELETE', { Cookie: '__Host-fgs_token=x' }))?.status).toBe(403);
  });

  it('403s when Sec-Fetch-Site is anything but same-origin', () => {
    expect(rejectCrossSite(req('POST', { 'Sec-Fetch-Site': 'same-site' }))?.status).toBe(403);
    expect(rejectCrossSite(req('POST', { 'Sec-Fetch-Site': 'cross-site' }))?.status).toBe(403);
    expect(rejectCrossSite(req('POST', { 'Sec-Fetch-Site': 'none' }))?.status).toBe(403);
  });

  it('a foreign Origin is not rescued by a same-origin Sec-Fetch-Site', () => {
    expect(
      rejectCrossSite(req('POST', { Origin: GAME, 'Sec-Fetch-Site': 'same-origin' }))?.status,
    ).toBe(403);
  });

  it('does not accept a subdomain or suffix spoof of the console origin', () => {
    expect(
      rejectCrossSite(req('POST', { Origin: 'https://console.freegamestore.online.evil.example' }))
        ?.status,
    ).toBe(403);
    expect(
      rejectCrossSite(req('POST', { Origin: 'https://evil.console.freegamestore.online' }))?.status,
    ).toBe(403);
    expect(rejectCrossSite(req('POST', { Origin: 'null' }))?.status).toBe(403);
  });

  it('415s a first-party request whose body is not JSON (preflight-free text/plain)', async () => {
    const res = rejectCrossSite(
      req('POST', { Origin: CONSOLE, 'Content-Type': 'text/plain' }, '{}'),
    );
    expect(res?.status).toBe(415);
    expect(((await res!.json()) as { error: string }).error).toBe('application/json required');
    expect(rejectCrossSite(req('POST', { Origin: CONSOLE }, '{"id":"x"}'))?.status).toBe(415);
    expect(
      rejectCrossSite(
        req('PUT', { Origin: CONSOLE, 'Content-Type': 'application/x-www-form-urlencoded' }, 'a=b'),
      )?.status,
    ).toBe(415);
  });
});
