import { normalizeErrorLogRow } from '../../../../contracts/error-log/v1/contract';
import type { DataService } from '../data';
import { recordError } from '../errlog';
import { corsHeaders, jsonResponse } from '../http';
import type { Route } from './types';

export function ciRoutes(_data: DataService): Route[] {
  return [
    // POST /api/internal/error
    {
      method: 'POST',
      pattern: '/api/internal/error',
      auth: 'internal',
      handler: async ({ request, env }) => {
        const body = (await request.json().catch(() => ({}))) as {
          source?: unknown;
          user?: unknown;
          context?: unknown;
          message?: unknown;
          stack?: unknown;
        };
        const row = normalizeErrorLogRow(body);
        if (!row) {
          return jsonResponse({ error: 'source and message are required' }, 400, request);
        }
        await recordError(env.DB, row);
        return jsonResponse({ ok: true }, 200, request);
      },
    },

    // PUT /api/ci/test-report
    {
      method: 'PUT',
      pattern: '/api/ci/test-report',
      auth: 'ci',
      handler: async ({ request, env }) => {
        if (!env.CI_KV) return jsonResponse({ error: 'CI_KV not bound' }, 503, request);
        const html = await request.text();
        const MAX_REPORT_BYTES = 512 * 1024;
        const bytes = new TextEncoder().encode(html).length;
        if (bytes > MAX_REPORT_BYTES) {
          return jsonResponse(
            { error: `report too large (${bytes} bytes, max ${MAX_REPORT_BYTES})` },
            413,
            request,
          );
        }
        await env.CI_KV.put('latest-test-report', html);
        return jsonResponse({ ok: true, bytes }, 200, request);
      },
    },

    // GET /api/ci/test-report
    {
      method: 'GET',
      pattern: '/api/ci/test-report',
      auth: 'admin',
      handler: async ({ request, env }) => {
        if (!env.CI_KV) return jsonResponse({ error: 'CI_KV not bound' }, 503, request);
        const html = await env.CI_KV.get('latest-test-report');
        if (html === null) return jsonResponse({ error: 'no report stored yet' }, 404, request);
        return new Response(html, {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            ...corsHeaders(request),
          },
        });
      },
    },
  ];
}
