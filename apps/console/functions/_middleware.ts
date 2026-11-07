// Deny by default for the create canary's session (#531).
//
// The canary signs in with a keyless, 15-minute fgs_token that names no person
// (contracts/canary-session). It may create and delete one throwaway
// `e2e-create-*-test` game through the two routes below, and nothing else. Every
// other function here (the /auth/* routes included) refuses it, so a route added
// later cannot accept it by accident. The two allowed routes still verify the
// session and the game id themselves (api/create.ts, api/games/[id].ts); this
// only decides which routes the canary can reach at all.

import { isCanaryToken } from '../../../contracts/canary-session/v1/contract';
import { getCookie, SESSION_COOKIE } from './api/_auth';

const CANARY_ROUTES: { method: string; path: RegExp }[] = [
  { method: 'POST', path: /^\/api\/create\/?$/ },
  { method: 'DELETE', path: /^\/api\/games\/[^/]+\/?$/ },
];

export const onRequest: PagesFunction = async (context) => {
  const { request } = context;
  if (isCanaryToken(getCookie(request, SESSION_COOKIE))) {
    const { pathname } = new URL(request.url);
    if (!CANARY_ROUTES.some((r) => r.method === request.method && r.path.test(pathname))) {
      return new Response(JSON.stringify({ error: 'forbidden', reason: 'canary_session' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }
  }
  return context.next();
};
