import { DOMAIN, fetchRegistryItems, ORG } from './data';
import { type FleetRow, sweepFleet } from './drift';
import type { Env } from './env';
import { recordError } from './errlog';
import { insertHostRoute } from './publish';
import { readRegistry } from './registryReader';
import { registryState } from './services';

/** Latest CONCLUDED deploy.yml outcome for a game repo, or null when nothing has
 *  concluded yet (no runs, still queued/in-progress, or the API call failed).
 *
 *  Filters to deploy.yml specifically: a game repo carries several workflows
 *  (ci/compliance/deploy) and "latest run of any workflow" reads the wrong
 *  conclusion. `cancelled` is skipped rather than treated as failure — Path B
 *  provisioning lands several commits in quick succession and deploy.yml's
 *  `concurrency: cancel-in-progress` cancels the earlier runs by design, so a
 *  cancelled run says nothing about the build. Mirrors the agent's
 *  waitForActionsDeploy. */
/** Commit messages of provisioning's own commits (GitHub's template generate,
 *  then admin's naming / remix commits). Used to recognise scaffold runs for
 *  registry entries that predate `provisionedSha`. */
export const PROVISIONING_COMMIT =
  /^(?:Initial commit$|Set game name to "|Remix source from |Add immutable Remix attribution)/;

export type DeployRun = {
  status: string;
  conclusion: string | null;
  head_sha?: string;
  head_commit?: { message?: string } | null;
};

/** Whether a deploy run built only the unbuilt template scaffold (#67): a commit
 *  at or before `provisionedSha`, the repo HEAD when provisioning finished. A
 *  run on a later commit, or on unrelated history (the creator force-pushed
 *  their own project over the scaffold), is real creator code. When GitHub
 *  can't answer, the run is treated as scaffold, so the game stays pending
 *  rather than being declared live on a guess. */
export async function isScaffoldRun(
  env: Pick<Env, 'GITHUB_TOKEN'>,
  id: string,
  run: DeployRun,
  provisionedSha?: string,
): Promise<boolean> {
  if (!provisionedSha) return PROVISIONING_COMMIT.test(run.head_commit?.message ?? '');
  if (!run.head_sha) return true;
  if (run.head_sha === provisionedSha) return true;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${ORG}/${id}/compare/${provisionedSha}...${run.head_sha}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'freegamestore-admin',
          ...(env.GITHUB_TOKEN ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}),
        },
      },
    );
    if (res.status === 404) return false; // no common history: a force-pushed project
    if (!res.ok) return true;
    const { status } = (await res.json()) as { status?: string };
    return status === 'identical' || status === 'behind';
  } catch {
    return true;
  }
}

export async function latestDeployConclusion(
  env: Env,
  id: string,
  provisionedSha?: string,
): Promise<'success' | 'failure' | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${ORG}/${id}/actions/workflows/deploy.yml/runs?per_page=5`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'freegamestore-admin',
          ...(env.GITHUB_TOKEN ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}),
        },
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { workflow_runs?: DeployRun[] };
    for (const run of data.workflow_runs ?? []) {
      if (run.status !== 'completed' || run.conclusion === 'cancelled') continue;
      // The template scaffold's own build says nothing about the game (#67):
      // it succeeds for a game whose code was never pushed.
      if (await isScaffoldRun(env, id, run, provisionedSha)) continue;
      if (run.conclusion === 'success') return 'success';
      if (run.conclusion === 'failure' || run.conclusion === 'timed_out') return 'failure';
    }
    return null;
  } catch {
    return null;
  }
}

/** One cached fleet sweep shared by /api/drift and /api/status/deploys.
 *
 *  ~2 GitHub calls per game (~250 for the current fleet), so it is cached 5
 *  minutes in the Worker cache. The cached copy lives under an INTERNAL key and
 *  is never the client response — those stay no-store, so per-admin data is
 *  never edge-cached. Returns null when the registry read failed, which callers
 *  must surface rather than treating as an empty fleet. */
export async function cachedFleetSweep(env: Env): Promise<FleetRow[] | null> {
  const cacheKey = new Request('https://admin.freegamestore.online/__cache/fleet');
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const hit = cache ? await cache.match(cacheKey).catch(() => null) : null;
  if (hit) return (await hit.json()) as FleetRow[];

  const items = await fetchRegistryItems(env);
  if (items === null) return null;
  const ids = items.map((g) => g?.id).filter((id): id is string => typeof id === 'string' && !!id);
  const rows = await sweepFleet(env, ORG, ids);
  if (cache) {
    await cache
      .put(
        cacheKey,
        new Response(JSON.stringify(rows), {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=300' },
        }),
      )
      .catch(() => {
        /* caching is best-effort */
      });
  }
  return rows;
}

export interface ReconcileReport {
  ts: string;
  registryCount: number;
  routeCount: number;
  /** In the storefront registry but no D1 route → host returns 404 / CF 1014. */
  missingRoute: string[];
  /** Has a D1 route but isn't in the registry → drift (provision half-done or unlisted). */
  orphanRoute: string[];
  drift: boolean;
  /** True when the registry read FAILED (not merely empty). In this state the
   *  comparison is untrustworthy, so no drift is claimed and no healing runs. */
  registryError?: boolean;
  /** Set when route healing was skipped because the registry read was not
   *  fresh (it came from the cached raw copy) (#64). */
  healSkipped?: 'stale-registry';
  /** Registry entries still `pending` — provisioned, first build not yet confirmed. */
  pending?: string[];
  /** Populated only on the scheduled (heal=true) path: what was actually fixed. */
  healed?: {
    insertedRoutes: string[];
    deletedRoutes: string[];
    /** Orphans NOT deleted because their game repo is still live (#363). */
    keptRoutes?: string[];
    statusFlips?: string[];
  };
}

/** Whether an orphan route's game is really gone. A route is only deleted when
 *  its repo is missing or archived (what deleting a game does). A live repo
 *  means the registry read is the thing that's wrong: #363's 19 games had their
 *  routes deleted every hour by an admin build reading the archived registry.
 *  Any doubt (GitHub error, rate limit) keeps the route. */
export async function orphanRepoIsGone(env: Env, slug: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.github.com/repos/${ORG}/${encodeURIComponent(slug)}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'freegamestore-admin',
        ...(env.GITHUB_TOKEN ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}),
      },
    });
    if (res.status === 404) return true;
    if (!res.ok) return false;
    const repo = (await res.json()) as { archived?: unknown };
    return repo.archived === true;
  } catch {
    return false;
  }
}

/** Compare the storefront registry against the D1 `routes` table and surface —
 *  and, on the scheduled path, HEAL — provisioning drift. A registry entry with
 *  no route is the CF-1014 symptom (game listed but unservable); a route with no
 *  registry entry is a half-done provision.
 *
 *  `heal=false` (the GET /api/reconcile report): read-only, mutates nothing.
 *  `heal=true` (the hourly cron): auto-fixes the two SAFE cases —
 *    - missingRoute → re-insert the idempotent host route (registry is truth).
 *    - orphanRoute  → delete the route (registry is truth; the game is delisted).
 *  It never archives/deletes a repo. If the registry read failed it heals
 *  NOTHING — a bad read must never delete a live route. */
/** Routes created or updated this recently are never deleted as orphans (#64). */
export const ORPHAN_GRACE_MS = 10 * 60_000;

export async function reconcile(env: Env, heal = false): Promise<ReconcileReport> {
  const registry = await readRegistry(env.GITHUB_TOKEN);
  const items = registry.status === 'available' ? registry.games : null;
  const ts = new Date().toISOString();

  const routeRows = env.DB
    ? await env.DB.prepare(
        `SELECT slug, updated_at FROM routes WHERE zone = ? AND hosted_on = 'r2'`,
      )
        .bind(DOMAIN)
        .all<{ slug: string; updated_at?: number | null }>()
    : { results: [] as { slug: string; updated_at?: number | null }[] };
  const routeSlugs = new Set((routeRows.results ?? []).map((r) => r.slug));
  const routeUpdatedAt = new Map(
    (routeRows.results ?? []).map((r) => [r.slug, Number(r.updated_at) || 0]),
  );

  // Registry read failed → do NOT treat every route as orphan drift (that would
  // delete the whole fleet's routes once healing runs). Report the error, act on
  // nothing.
  if (items === null) {
    const report: ReconcileReport = {
      ts,
      registryCount: 0,
      routeCount: routeSlugs.size,
      missingRoute: [],
      orphanRoute: [],
      drift: false,
      registryError: true,
    };
    console.error(`[reconcile] registry read FAILED — skipping (no drift claimed, no heal)`);
    await recordError(env.DB, {
      source: 'admin/reconcile',
      context: `heal=${heal}`,
      message: 'registry read failed — reconcile skipped to avoid false drift',
    });
    return report;
  }

  const registryIds = new Set(items.map((g) => g.id).filter(Boolean));
  const missingRoute = [...registryIds].filter((id) => !routeSlugs.has(id)).sort();
  const orphanRoute = [...routeSlugs].filter((slug) => !registryIds.has(slug)).sort();
  const pending = items
    .filter((g) => g?.id && registryState.readStatus(g) === 'pending')
    .map((g) => g.id as string)
    .sort();

  const report: ReconcileReport = {
    ts,
    registryCount: registryIds.size,
    routeCount: routeSlugs.size,
    missingRoute,
    orphanRoute,
    pending,
    // A pending game is NOT drift — provisioning before the build is deliberate.
    // It only becomes interesting if it never resolves, which the flip below
    // handles rather than alarming about.
    drift: missingRoute.length > 0 || orphanRoute.length > 0,
  };

  // Route healing acts only on a FRESH registry read (#64). The raw CDN copy can
  // lag a write by minutes, and the Contents API falls back to it on a 403 —
  // e.g. when the fleet sweep exhausts GITHUB_TOKEN's rate limit. Healing from
  // it deleted a just-provisioned game's route as an "orphan" (404 until the
  // next run) and re-inserted the route of a just-deleted game, which the host
  // then served again from R2. Drift is still reported; it heals next run.
  const freshRegistry = registry.status === 'available' && registry.source === 'contents';
  if (heal && report.drift && !freshRegistry) {
    report.healSkipped = 'stale-registry';
    console.warn('[reconcile] registry came from the cached raw copy — route heal skipped');
    // Logged, not just warned: a skip that repeats every hour leaves listed
    // games unserved, and a console line nobody tails let #363 run for days.
    await recordError(env.DB, {
      source: 'admin/reconcile',
      context: `heal=${heal}`,
      message: `route heal skipped (stale registry read): ${missingRoute.length} missingRoute, ${orphanRoute.length} orphanRoute left as is`,
    });
  }
  if (heal && env.DB && report.drift && freshRegistry) {
    const insertedRoutes: string[] = [];
    const deletedRoutes: string[] = [];
    const keptRoutes: string[] = [];
    // Re-insert routes for listed-but-unrouted games (idempotent, same shape as
    // provision). registry is the source of truth for what SHOULD be served.
    for (const id of missingRoute) {
      const step = await insertHostRoute(env, id);
      if (step.status === 'ok') insertedRoutes.push(id);
    }
    // Delete routes with no registry entry — the game is delisted, so the route
    // should stop resolving. Repos are left untouched (archive is not automatic).
    for (const slug of orphanRoute) {
      // Extra guard: never delete a route touched in the last few minutes;
      // if it is truly orphaned, a later run removes it.
      if (Date.now() - (routeUpdatedAt.get(slug) ?? 0) < ORPHAN_GRACE_MS) continue;
      // And never delete one whose game repo is still live (#363).
      if (!(await orphanRepoIsGone(env, slug))) {
        keptRoutes.push(slug);
        continue;
      }
      try {
        await env.DB.prepare('DELETE FROM routes WHERE slug = ? AND zone = ?')
          .bind(slug, DOMAIN)
          .run();
        deletedRoutes.push(slug);
      } catch {
        /* best-effort; next run retries */
      }
    }
    report.healed = {
      insertedRoutes,
      deletedRoutes,
      ...(keptRoutes.length ? { keptRoutes } : {}),
    };
    if (keptRoutes.length) {
      await recordError(env.DB, {
        source: 'admin/reconcile',
        context: `heal=${heal}`,
        message: `kept ${keptRoutes.length} route(s) with a live repo but no registry entry: ${keptRoutes.join(', ')}`,
      });
    }
  }

  // Backstop for the build-status field (#22). The agent reports the CI outcome
  // the moment it sees it, but it is NOT the only publisher — `fgs publish` (CLI)
  // and the MCP `create_game` tool provision without it, and any agent run that
  // dies mid-deploy never reports at all. Without this sweep those games would
  // sit `pending` forever and be hidden from the store — a worse bug than the one
  // #22 fixes. One batched registry commit per run, and it only ever moves
  // pending → live/failed.
  if (heal && pending.length > 0) {
    const flips: Array<{ id: string; status: 'live' | 'failed' }> = [];
    for (const id of pending) {
      const entry = items.find((g) => g?.id === id);
      const provisionedSha =
        typeof entry?.provisionedSha === 'string' ? entry.provisionedSha : undefined;
      const conclusion = await latestDeployConclusion(env, id, provisionedSha);
      if (conclusion === 'success') flips.push({ id, status: 'live' });
      else if (conclusion === 'failure') flips.push({ id, status: 'failed' });
      // null → nothing concluded yet; leave pending for the next run.
    }
    if (flips.length > 0) {
      const res = await registryState.setStatuses(env, flips);
      report.healed = {
        ...(report.healed ?? { insertedRoutes: [], deletedRoutes: [] }),
        statusFlips: res.updated,
      };
      if (!res.ok) {
        console.error(`[reconcile] status flip FAILED: ${res.detail}`);
        await recordError(env.DB, {
          source: 'admin/reconcile',
          context: `heal=${heal}`,
          message: `build-status flip failed: ${res.detail}`,
        });
      } else {
        console.log(`[reconcile] status flips: ${res.updated.join(', ') || 'none'}`);
      }
    }
  }

  if (report.drift) {
    console.error(`[reconcile] DRIFT detected: ${JSON.stringify(report)}`);
    await recordError(env.DB, {
      source: 'admin/reconcile',
      context: `heal=${heal}`,
      message: `drift: ${missingRoute.length} missingRoute, ${orphanRoute.length} orphanRoute`,
      stack: JSON.stringify(report).slice(0, 1500),
    });
  } else {
    console.log(`[reconcile] clean: ${report.registryCount} games, ${report.routeCount} routes`);
  }
  return report;
}

/** Check if a game host is reachable via HTTP HEAD request. */
export async function probeLiveGame(gameId: string, domain: string): Promise<Response | null> {
  try {
    const host = `https://${gameId}.${domain}`;
    return await fetch(host, { method: 'HEAD' });
  } catch {
    return null;
  }
}
