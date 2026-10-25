import { describe, expect, it } from 'vitest';
import { usesAdminSpaNavigationFallback } from '../web/src/navigationFallback';

describe('admin PWA navigation fallback', () => {
  it.each([
    '/auth/handoff',
    '/auth/handoff/',
    '/api/analytics/platform',
    '/v1/auth/me',
    '/docs',
    '/docs/',
  ])('leaves the worker-owned route %s on the network', (pathname) => {
    expect(usesAdminSpaNavigationFallback(pathname)).toBe(false);
  });

  it.each(['/', '/games', '/games/chess', '/ops'])('serves the SPA route %s', (pathname) => {
    expect(usesAdminSpaNavigationFallback(pathname)).toBe(true);
  });

  it('does not reject lookalike SPA routes', () => {
    expect(usesAdminSpaNavigationFallback('/authentication')).toBe(true);
    expect(usesAdminSpaNavigationFallback('/documentation')).toBe(true);
  });
});
