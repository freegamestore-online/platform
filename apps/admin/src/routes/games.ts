import type { DataService } from '../data';
import { getGameAnalytics, putGameAnalyticsConfig } from '../game-analytics';
import { jsonResponse } from '../http';
import { handlePlatformUsage } from '../platform-usage';
import { lifecycleStatus } from '../publish';
import { gameLifecycle } from '../services';
import {
  GAME_ID_RE,
  listOwnerTransfers,
  parseTransferBody,
  transferGameOwner,
} from '../transfer-owner';
import type { GameLifecycleResult, Route } from './types';

export function gamesRoutes(data: DataService): Route[] {
  return [
    // PATCH /api/games/:id
    {
      method: 'PATCH',
      pattern: /^\/api\/games\/([a-z0-9][a-z0-9-]*)$/,
      auth: 'login',
      handler: async ({ request, match, caller, env }) => {
        const id = match?.[1];
        if (!id) return jsonResponse({ error: 'invalid game id' }, 400, request);
        const login = caller.login;
        if (!login) return jsonResponse({ error: 'unauthorized' }, 401, request);

        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return jsonResponse({ error: 'invalid JSON' }, 400, request);
        }
        const result: GameLifecycleResult = await gameLifecycle.update(id, login, body, env);
        return jsonResponse(result, result.error ? lifecycleStatus(result.code) : 200, request);
      },
    },

    // DELETE /api/games/:id
    {
      method: 'DELETE',
      pattern: /^\/api\/games\/([a-z0-9][a-z0-9-]*)$/,
      // 'public': the handler requires a creator login OR an admin. auth: 'login'
      // turned away an admin's Google session (no GitHub login), so the admin
      // override below could never run (#361).
      auth: 'public',
      handler: async ({ request, match, caller, env }) => {
        const id = match?.[1];
        if (!id) return jsonResponse({ error: 'invalid game id' }, 400, request);

        const login = caller.login;
        const { isAdmin } = caller;
        const actor = login || (isAdmin ? caller.admin : null);
        if (!actor) {
          return jsonResponse({ error: 'unauthorized' }, 401, request);
        }

        const result: GameLifecycleResult = await gameLifecycle.delete(id, actor, env, {
          adminOverride: isAdmin,
        });
        return jsonResponse(result, result.error ? lifecycleStatus(result.code) : 200, request);
      },
    },

    // POST /api/admin/transfer-owner — admin-only compare-and-set ownership
    // transfer (#358). GET lists one game's transfer audit. Gated in the
    // handler rather than with auth: 'admin' so a signed-in non-admin gets 403,
    // not the 401 that means "not signed in".
    {
      method: ['GET', 'POST'],
      pattern: '/api/admin/transfer-owner',
      auth: 'public',
      handler: async ({ request, url, caller, env }) => {
        if (!caller.admin && !caller.login) {
          return jsonResponse({ error: 'unauthorized' }, 401, request);
        }
        // The audit record names a person: the admin's verified email.
        if (!caller.isAdmin || !caller.admin) {
          return jsonResponse({ error: 'admin session required' }, 403, request);
        }
        if (request.method === 'GET') {
          const gameId = (url.searchParams.get('game_id') ?? '').trim();
          if (!GAME_ID_RE.test(gameId)) {
            return jsonResponse({ error: 'invalid game id' }, 400, request);
          }
          return jsonResponse(
            { transfers: await listOwnerTransfers(env.DB, gameId) },
            200,
            request,
          );
        }
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return jsonResponse({ error: 'expected a JSON object' }, 400, request);
        }
        const parsed = parseTransferBody(body);
        if (!parsed.ok) return jsonResponse({ error: parsed.error }, 400, request);
        const outcome = await transferGameOwner(env, parsed.value, caller.admin);
        console.log(
          `[transfer-owner] ${parsed.value.game_id} ${parsed.value.from_login} -> ${parsed.value.to_login} by ${caller.admin}: ${outcome.status}`,
        );
        return jsonResponse(outcome.body, outcome.status, request);
      },
    },

    // GET /api/games/:id/analytics — owner-only usage stats + BYO tag config (#354).
    {
      method: 'GET',
      pattern: /^\/api\/games\/([a-z0-9][a-z0-9-]*)\/analytics$/,
      auth: 'login',
      handler: async ({ request, match, caller, env }) => {
        const id = match?.[1];
        if (!id) return jsonResponse({ error: 'invalid game id' }, 400, request);
        if (!caller.login) return jsonResponse({ error: 'unauthorized' }, 401, request);
        const result = await getGameAnalytics(
          env,
          id,
          caller.login,
          await data.registryItems(),
          new URL(request.url).searchParams,
        );
        return jsonResponse(result.body, result.status, request);
      },
    },

    // PUT /api/games/:id/analytics — owner-only BYO tags (GA4, Plausible) (#354).
    {
      method: 'PUT',
      pattern: /^\/api\/games\/([a-z0-9][a-z0-9-]*)\/analytics$/,
      auth: 'login',
      handler: async ({ request, match, caller, env }) => {
        const id = match?.[1];
        if (!id) return jsonResponse({ error: 'invalid game id' }, 400, request);
        if (!caller.login) return jsonResponse({ error: 'unauthorized' }, 401, request);
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return jsonResponse({ error: 'invalid JSON' }, 400, request);
        }
        const result = await putGameAnalyticsConfig(
          env,
          id,
          caller.login,
          await data.registryItems(),
          body,
        );
        return jsonResponse(result.body, result.status, request);
      },
    },

    // GET /api/analytics/platform — admin-only cross-game usage dashboard (#351).
    // Gated in handlePlatformUsage: 401 anonymous, 403 signed-in non-admin. Not
    // auth: 'login', which needs a GitHub login that an admin's Google session
    // never has, so every admin got 401 (#361).
    {
      method: 'GET',
      pattern: '/api/analytics/platform',
      auth: 'public',
      handler: async ({ request, caller, env }) => {
        const result = await handlePlatformUsage(caller, env, await data.registryItems());
        return jsonResponse(result.body, result.status, request);
      },
    },
  ];
}
