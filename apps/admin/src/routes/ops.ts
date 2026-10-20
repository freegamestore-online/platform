import { type DataService, DOMAIN, ORG } from '../data';
import { driftReportFrom, recentRuns } from '../drift';
import { errorStats, listErrors, recordError } from '../errlog';
import { cachedFleetSweep, probeLiveGame, reconcile } from '../fleet';
import { jsonResponse } from '../http';
import { docsPage } from '../pages';
import { insertHostRoute, readGameStatus } from '../publish';
import { registryState } from '../services';
import type { Route } from './types';

export function opsRoutes(_data: DataService): Route[] {
  return [
    // GET /api/drift and GET /api/status/deploys
    {
      method: 'GET',
      pattern: /^\/api\/(drift|status\/deploys)$/,
      auth: 'admin',
      handler: async ({ url, request, env }) => {
        const rows = await cachedFleetSweep(env);
        if (rows === null) {
          return jsonResponse({ error: 'registry read failed — fleet not swept' }, 503, request);
        }
        if (url.pathname === '/api/status/deploys') {
          return jsonResponse(
            {
              ts: new Date().toISOString(),
              games: rows.map((r) => ({
                id: r.id,
                conclusion: r.conclusion,
                drifted: r.state === 'drifted',
              })),
            },
            200,
            request,
          );
        }
        const report = driftReportFrom(rows);
        if (report.drifted.length) {
          console.warn(
            `[drift] ${report.drifted.length} game(s) serving stale builds: ${report.drifted.map((d) => d.id).join(', ')}`,
          );
        }
        return jsonResponse(report, 200, request);
      },
    },

    // GET /api/ping
    {
      method: 'GET',
      pattern: '/api/ping',
      auth: 'admin',
      handler: async ({ request }) => {
        return jsonResponse({ ok: true, worker: 'freegamestore-admin' }, 200, request);
      },
    },

    // GET /api/games/:id/detail
    {
      method: 'GET',
      pattern: /^\/api\/games\/([a-z0-9][a-z0-9-]*)\/detail$/,
      auth: 'admin',
      handler: async ({ request, match, env, data: dataService_param }) => {
        const id = match?.[1];
        if (!id) return jsonResponse({ error: 'invalid game id' }, 400, request);
        const items = (await dataService_param.registryItems()) ?? [];
        const entry = items.find((g) => g?.id === id) ?? null;

        const routeRow = env.DB
          ? await env.DB.prepare(
              'SELECT slug, r2_prefix, hosted_on FROM routes WHERE slug = ? AND zone = ?',
            )
              .bind(id, DOMAIN)
              .first()
          : null;

        const httpResponse = routeRow ? await probeLiveGame(id, DOMAIN) : null;
        // @ts-expect-error
        const runs = entry ? await recentRuns(env, ORG, entry.repo) : [];

        return jsonResponse(
          {
            id,
            listed: !!entry,
            status: readGameStatus(entry),
            route: { configured: !!routeRow },
            http: {
              ok: httpResponse?.ok ?? false,
              status: httpResponse?.status ?? 502,
            },
            runs: runs.slice(0, 5),
            ...(entry && { forkedFrom: entry.forkedFrom }),
          },
          200,
          request,
        );
      },
    },

    // GET /api/reconcile
    {
      method: 'GET',
      pattern: '/api/reconcile',
      auth: 'admin',
      handler: async ({ request, env }) => {
        const report = await reconcile(env, false);
        return jsonResponse(report, 200, request);
      },
    },

    // GET /docs
    {
      method: 'GET',
      pattern: '/docs',
      auth: 'public',
      handler: async ({ caller }) => docsPage(caller),
    },

    // GET /api/status
    {
      method: 'GET',
      pattern: '/api/status',
      auth: 'admin',
      handler: async ({ request, data: dataService_param }) => {
        const items = await dataService_param.registryItems();
        if (items === null) {
          return jsonResponse({ error: 'registry read failed' }, 503, request);
        }
        const games = items.map((g) => ({
          id: g?.id,
          status: readGameStatus(g),
        }));
        return jsonResponse(games, 200, request);
      },
    },

    // GET /api/status/game
    {
      method: 'GET',
      pattern: '/api/status/game',
      auth: 'admin',
      handler: async ({ request, url, data: dataService_param }) => {
        const id = url.searchParams.get('id');
        if (!id) return jsonResponse({ error: 'id param required' }, 400, request);
        const items = await dataService_param.registryItems();
        const entry = items?.find((g) => g?.id === id) ?? null;
        return jsonResponse(
          { id, status: readGameStatus(entry), entry: entry || null },
          200,
          request,
        );
      },
    },

    // GET /api/quality
    {
      method: 'GET',
      pattern: '/api/quality',
      auth: 'admin',
      handler: async ({ request, data: dataService_param }) => {
        const items = await dataService_param.registryItems();
        return jsonResponse(
          {
            total: items?.length ?? 0,
            issues: [],
          },
          200,
          request,
        );
      },
    },

    // GET /api/errors
    {
      method: 'GET',
      pattern: '/api/errors',
      auth: 'admin',
      handler: async ({ request, url, env }) => {
        const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit')) || 200));
        const user = url.searchParams.get('user') || undefined;
        const source = url.searchParams.get('source') || undefined;
        const errors = await listErrors(env.DB, limit, { user, source });
        return jsonResponse(errors, 200, request);
      },
    },

    // GET /api/stats
    {
      method: 'GET',
      pattern: '/api/stats',
      auth: 'admin',
      handler: async ({ request, env }) => {
        const stats = await errorStats(env.DB);
        return jsonResponse(stats, 200, request);
      },
    },

    // GET /api/users
    {
      method: 'GET',
      pattern: '/api/users',
      auth: 'admin',
      handler: async ({ request, data: dataService_param }) => {
        const items = await dataService_param.registryItems();
        if (!items) return jsonResponse({ error: 'registry read failed' }, 503, request);
        const creators = new Map<string, { count: number; games: string[] }>();
        for (const item of items) {
          if (typeof item?.creatorGithub === 'string') {
            const login = item.creatorGithub.toLowerCase();
            if (!creators.has(login)) {
              creators.set(login, { count: 0, games: [] });
            }
            const user = creators.get(login)!;
            user.count++;
            user.games.push(item.id);
          }
        }
        return jsonResponse(
          Array.from(creators.entries()).map(([login, data]) => ({
            login,
            ...data,
          })),
          200,
          request,
        );
      },
    },

    // GET /api/games/:id/traffic
    {
      method: 'GET',
      pattern: /^\/api\/games\/([a-z0-9][a-z0-9-]*)\/traffic$/,
      auth: 'admin',
      handler: async ({ request, match, env }) => {
        if (!env.CF_API_TOKEN || !env.CF_ZONE_ID) {
          return jsonResponse({ error: 'CF_API_TOKEN or CF_ZONE_ID not configured' }, 503, request);
        }
        const id = match?.[1];
        if (!id) return jsonResponse({ error: 'invalid game id' }, 400, request);
        const host = `${id}.${DOMAIN}`;
        const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
        const until = new Date().toISOString().slice(0, 10);
        const query = `query Traffic($zone: String!, $since: Date!, $until: Date!, $host: String!) {
  viewer {
    zones(filter: { zoneTag: $zone }) {
      httpRequests1dGroups(
        limit: 60
        filter: { date_geq: $since, date_leq: $until, clientRequestHTTPHost: $host }
        orderBy: [date_ASC]
      ) {
        dimensions { date }
        sum { requests pageViews bytes }
        uniq { uniques }
      }
    }
  }
}`;
        try {
          const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${env.CF_API_TOKEN}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              query,
              variables: { zone: env.CF_ZONE_ID, since, until, host },
            }),
          });
          if (!res.ok) {
            return jsonResponse(
              { error: `Cloudflare Analytics returned ${res.status}` },
              502,
              request,
            );
          }
          const data = (await res.json()) as Record<string, unknown>;
          if (Array.isArray(data?.errors) && data.errors.length) {
            return jsonResponse(
              { error: data.errors[0]?.message || 'Analytics query failed' },
              502,
              request,
            );
          }
          const graphqlData = data.data as Record<string, unknown> | undefined;
          const viewer = graphqlData?.viewer as Record<string, unknown> | undefined;
          const zones = viewer?.zones as Record<string, unknown>[] | undefined;
          const firstZone = zones?.[0] as Record<string, unknown> | undefined;
          const groups: Array<Record<string, unknown>> =
            (firstZone?.httpRequests1dGroups as Record<string, unknown>[]) ?? [];
          const days = groups.map((g) => ({
            date: ((g?.dimensions as Record<string, unknown>)?.date as string | null) ?? null,
            requests: Number((g?.sum as Record<string, unknown>)?.requests) || 0,
            pageViews: Number((g?.sum as Record<string, unknown>)?.pageViews) || 0,
            visitors: Number((g?.uniq as Record<string, unknown>)?.uniques) || 0,
          }));
          return jsonResponse(
            {
              host,
              since,
              until,
              days,
              totals: {
                requests: days.reduce((n, d) => n + d.requests, 0),
                pageViews: days.reduce((n, d) => n + d.pageViews, 0),
                visitors: days.reduce((n, d) => n + d.visitors, 0),
              },
            },
            200,
            request,
          );
        } catch (e) {
          return jsonResponse({ error: `Analytics request failed: ${String(e)}` }, 502, request);
        }
      },
    },

    // POST /api/games/:id/heal-route
    {
      method: 'POST',
      pattern: /^\/api\/games\/([a-z0-9][a-z0-9-]*)\/heal-route$/,
      auth: 'admin',
      handler: async ({ request, match, env, data: dataService_param }) => {
        const id = match?.[1];
        if (!id) return jsonResponse({ error: 'invalid game id' }, 400, request);
        const items = await dataService_param.registryItems();
        if (items === null) {
          return jsonResponse({ error: 'registry read failed — not healing blind' }, 503, request);
        }
        if (!items.some((g) => g?.id === id)) {
          return jsonResponse(
            {
              ok: false,
              step: {
                name: 'Hosting route',
                status: 'fail',
                detail: `${id} is not in the store registry — provision or re-list it first`,
              },
            },
            400,
            request,
          );
        }
        const step = await insertHostRoute(env, id);
        if (step.status === 'fail') {
          await recordError(env.DB, {
            source: 'admin/heal-route',
            context: `id=${id}`,
            message: step.detail,
          });
        }
        return jsonResponse(
          { ok: step.status !== 'fail', step },
          step.status === 'fail' ? 500 : 200,
          request,
        );
      },
    },

    // POST /api/game-status
    {
      method: 'POST',
      pattern: '/api/game-status',
      auth: 'internal',
      handler: async ({ request, env }) => {
        const body = (await request.json().catch(() => ({}))) as { id?: string; status?: string };
        if (!body.id || (body.status !== 'live' && body.status !== 'failed')) {
          return jsonResponse(
            { error: "id and status ('live'|'failed') are required" },
            400,
            request,
          );
        }
        const step = await registryState.setStatus(env, body.id, body.status as 'live' | 'failed');
        if (step.status === 'fail') {
          await recordError(env.DB, {
            source: 'admin/game-status',
            context: `id=${body.id} status=${body.status}`,
            message: step.detail,
          });
        }
        return jsonResponse(
          { ok: step.status !== 'fail', step },
          step.status === 'fail' ? 500 : 200,
          request,
        );
      },
    },
  ];
}
