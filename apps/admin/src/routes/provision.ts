import type { DataService } from '../data';
import { recordError } from '../errlog';
import { jsonResponse, safeEqual } from '../http';
import { provisionStatus } from '../publish';
import { gameLifecycle } from '../services';
import type { Route } from './types';

export function provisionRoutes(_data: DataService): Route[] {
  return [
    // POST /api/provision and POST /api/publish
    {
      method: 'POST',
      pattern: /^\/api\/(provision|publish)$/,
      auth: 'public',
      handler: async ({ request, env, caller }) => {
        const internal = request.headers.get('X-Internal-Token');
        const trusted = !!(
          internal &&
          env.INTERNAL_TOKEN &&
          safeEqual(internal, env.INTERNAL_TOKEN)
        );
        const { isAdmin } = caller;
        const login = trusted || isAdmin ? null : caller.login;
        if (!trusted && !isAdmin && !login) {
          return jsonResponse({ error: 'unauthorized' }, 401, request);
        }

        const t0 = Date.now();
        let ownerForLog: string | undefined;
        let idForLog: string | undefined;
        try {
          const body = (await request.json()) as Record<string, unknown>;
          idForLog = body?.id as string | undefined;
          const owner = trusted || isAdmin ? (body.creatorGithub as string | undefined) : login;
          ownerForLog = owner ?? undefined;
          if ((trusted || isAdmin) && !owner) {
            return jsonResponse(
              { error: 'creatorGithub required for admin/internal provision' },
              400,
              request,
            );
          }
          console.log(`[provision] id=${body?.id} owner=${owner} trusted=${trusted}`);
          const result = await gameLifecycle.provision(
            { ...body, creatorGithub: owner ?? undefined } as unknown as Parameters<
              typeof gameLifecycle.provision
            >[0],
            env,
          );
          console.log(`[provision] id=${body?.id} success=${result.success} +${Date.now() - t0}ms`);
          if (!result.success) {
            const failMsg =
              (result.steps || [])
                .filter((s) => s.status === 'fail')
                .map((s) => `${s.name}: ${s.detail}`)
                .join('; ') || 'provision returned success:false';
            await recordError(env.DB, {
              source: 'admin/provision',
              user: owner,
              context: `id=${body?.id} +${Date.now() - t0}ms`,
              message: failMsg,
              stack: JSON.stringify(result).slice(0, 1500),
            });
          }
          return jsonResponse(result, provisionStatus(result), request);
        } catch (e) {
          await recordError(env.DB, {
            source: 'admin/provision',
            user: ownerForLog,
            context: `id=${idForLog} threwAfter=${Date.now() - t0}ms`,
            message: (e as Error)?.message ?? String(e),
            stack: (e as Error)?.stack,
          });
          return jsonResponse({ error: String(e) }, 500, request);
        }
      },
    },
  ];
}
