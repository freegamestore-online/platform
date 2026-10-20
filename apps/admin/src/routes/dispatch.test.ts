import { describe, expect, it } from 'vitest';
import type { DataService } from '../data';
import { buildRouteTable } from './dispatch';

// #368 split the route table into group modules (ops, games, ci, agent proxy,
// provision). The dispatcher answers with the FIRST route matching method and
// path, so group order would matter if two routes could match the same request.
// This pins that none can, and that every route is still reachable.

const SAMPLE_PATHS = [
  '/api/drift',
  '/api/status/deploys',
  '/api/ping',
  '/api/games/chess/detail',
  '/api/reconcile',
  '/docs',
  '/api/status',
  '/api/status/game',
  '/api/quality',
  '/api/errors',
  '/api/stats',
  '/api/users',
  '/api/games/chess',
  '/api/admin/transfer-owner',
  '/api/internal/error',
  '/api/ci/test-report',
  '/api/games/chess/analytics',
  '/api/analytics/platform',
  '/api/games/chess/traffic',
  '/api/games/chess/heal-route',
  '/api/game-status',
  '/api/allusers',
  '/api/sessions',
  '/api/sessionhistory',
  '/api/sessionerrors',
  '/api/sessionchat',
  '/api/userkey/abc',
  '/api/comp',
  '/api/comp/grant',
  '/api/provision',
  '/api/publish',
];
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const routes = buildRouteTable({} as DataService);
const matches = (route: (typeof routes)[number], method: string, path: string) =>
  (typeof route.method === 'string' ? route.method === method : route.method.includes(method)) &&
  (typeof route.pattern === 'string' ? route.pattern === path : route.pattern.test(path));

describe('admin route table (#368)', () => {
  it('never matches one request with two routes, so group order is irrelevant', () => {
    for (const path of SAMPLE_PATHS) {
      for (const method of METHODS) {
        const hits = routes.filter((r) => matches(r, method, path));
        expect(hits.length, `${method} ${path}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('reaches every route from some sample request', () => {
    for (const route of routes) {
      const reached = SAMPLE_PATHS.some((p) => METHODS.some((m) => matches(route, m, p)));
      expect(reached, `${String(route.method)} ${String(route.pattern)}`).toBe(true);
    }
  });

  it('keeps all 25 routes', () => {
    expect(routes).toHaveLength(25);
  });
});
