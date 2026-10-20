import { resolveCaller } from '../caller';
import type { DataService } from '../data';
import { corsHeaders, jsonResponse } from '../http';
import type { Route } from './types';

export function agentProxyRoutes(_data: DataService): Route[] {
  return [
    // Agent proxy routes: /api/sessions, /api/allusers, /api/userkey*, /api/comp*, etc.
    {
      method: ['GET', 'POST', 'DELETE'],
      pattern:
        /^\/api\/(allusers|sessions|sessionhistory|sessionerrors|sessionchat|userkey.*|comp.*)$/,
      auth: 'admin',
      handler: async ({ request, url, env }) => {
        if (!env.AGENT || !env.INTERNAL_TOKEN) {
          return jsonResponse(
            { error: 'admin↔agent not wired (missing AGENT binding or INTERNAL_TOKEN)' },
            500,
            request,
          );
        }
        const caller = await resolveCaller(request, env);
        const agentPath =
          url.pathname === '/api/allusers'
            ? '/v1/admin/users'
            : url.pathname === '/api/sessions'
              ? `/v1/admin/sessions${url.search}`
              : url.pathname === '/api/sessionhistory'
                ? `/v1/admin/session-history${url.search}`
                : url.pathname === '/api/sessionerrors'
                  ? `/v1/admin/session-errors${url.search}`
                  : url.pathname === '/api/sessionchat'
                    ? `/v1/admin/session-chat${url.search}`
                    : url.pathname.startsWith('/api/userkey')
                      ? url.pathname.replace(/^\/api\/userkey/, '/v1/admin/userkey')
                      : url.pathname.replace(/^\/api\/comp/, '/v1/admin/comp');
        const res = await env.AGENT.fetch(`https://agent.freegamestore.online${agentPath}`, {
          method: request.method,
          headers: {
            'X-Internal-Token': env.INTERNAL_TOKEN,
            'X-Admin-Actor': caller.admin || 'admin',
            ...(request.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
          },
          body: request.method === 'POST' ? await request.text() : undefined,
        });
        // session-chat streams SSE back from the DO turn — pass it through untouched
        if (url.pathname === '/api/sessionchat') {
          return new Response(res.body, {
            status: res.status,
            headers: {
              'Content-Type': res.headers.get('Content-Type') || 'text/event-stream',
              'Cache-Control': 'no-store',
              ...corsHeaders(request),
            },
          });
        }
        const text = await res.text();
        return new Response(text, {
          status: res.status,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            ...corsHeaders(request),
          },
        });
      },
    },
  ];
}
