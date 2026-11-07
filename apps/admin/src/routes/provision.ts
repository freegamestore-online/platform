import {
  isCanaryGameId,
  isCanaryToken,
  presentedToken,
} from '../../../../contracts/canary-session/v1/contract';
import { authorizeCanary } from '../caller';
import type { DataService } from '../data';
import type { Env } from '../env';
import { recordError } from '../errlog';
import { jsonResponse, safeEqual } from '../http';
import { provisionStatus, strandedRepo } from '../publish';
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
          // The keyless create canary (#531) is the one other caller.
          if (
            /^\/api\/provision$/.test(new URL(request.url).pathname) &&
            isCanaryToken(presentedToken(request))
          )
            return provisionForCanary(request, env);
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
            const stranded = strandedRepo(result, String(body?.id));
            await recordError(env.DB, {
              source: 'admin/provision',
              user: owner,
              context: `id=${body?.id} +${Date.now() - t0}ms`,
              message: stranded
                ? `${failMsg} | STRANDED REPO: ${stranded} was created in this call but has no registry entry`
                : failMsg,
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

/**
 * Provision a throwaway game for the create canary (#531). Only a fresh
 * e2e-create-*-test id, only the fields below (no `cloneFrom`, no
 * `creatorGithub`), and nobody is invited to the repo: its owner is recorded as
 * the canary's sub. The id is checked before auth is asked, because asking for a
 * create takes one of the day's slots.
 */
async function provisionForCanary(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!isCanaryGameId(body?.id)) {
    return jsonResponse(
      { error: 'a canary session can only create e2e-create-*-test games' },
      403,
      request,
    );
  }
  const verdict = await authorizeCanary(request, env, 'create');
  if ('status' in verdict) return jsonResponse({ error: verdict.error }, verdict.status, request);
  console.log(`[provision] id=${body?.id} canary=${verdict.sub}`);
  try {
    const result = await gameLifecycle.provision(
      {
        id: body.id as string,
        name: body.name as string,
        category: body.category as string,
        icon: body.icon as string | undefined,
        iconBg: body.iconBg as string | undefined,
        description: body.description as string | undefined,
        oneliner: body.oneliner as string | undefined,
        template: body.template as string | undefined,
        creatorSub: verdict.sub,
      },
      env,
    );
    if (!result.success) {
      await recordError(env.DB, {
        source: 'admin/provision',
        user: verdict.sub,
        context: `id=${body.id} canary`,
        message:
          (result.steps || [])
            .filter((s) => s.status === 'fail')
            .map((s) => `${s.name}: ${s.detail}`)
            .join('; ') || 'provision returned success:false',
        stack: JSON.stringify(result).slice(0, 1500),
      });
    }
    return jsonResponse(result, provisionStatus(result), request);
  } catch (e) {
    await recordError(env.DB, {
      source: 'admin/provision',
      user: verdict.sub,
      context: `id=${body.id} canary`,
      message: (e as Error)?.message ?? String(e),
      stack: (e as Error)?.stack,
    });
    return jsonResponse({ error: String(e) }, 500, request);
  }
}
