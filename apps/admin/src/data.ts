import type { Env } from './env';
import type { GameStatus } from './publish';
import { type RegistryGame, readRegistry } from './registryReader';
import { registryState } from './services';

export interface GameConfig {
  id: string;
  name: string;
  org: string;
  cfProject: string;
  domain: string;
  hostedOn: string;
  /** Build lifecycle (#22). Always concrete here — readGameStatus resolves a
   *  missing/unrecognised registry value to "live", so the console never has to
   *  decide what an absent status means. */
  status: GameStatus;
}

export interface QualityGame {
  id: string;
  score: number;
  loadTimeMs: number;
  consoleErrors: string[];
}

export interface QualityData {
  timestamp: string;
  games: QualityGame[];
}

export const QUALITY_URL =
  'https://raw.githubusercontent.com/freegamestore-online/freegamestore/main/data/quality-results.json';
export const ORG = 'freegamestore-online';
export const DOMAIN = 'freegamestore.online';

/** Fetch raw registry items (source of truth for games).
 *  Prefers the authenticated GitHub contents API — which is NOT CDN-cached, so a
 *  game provisioned/edited seconds ago appears immediately (admin already holds
 *  GITHUB_TOKEN) — and falls back to the raw.githubusercontent.com CDN URL
 *  (cached ~5min) only when there is no token or the API call fails.
 *
 *  Returns `null` when EVERY attempt failed — which is NOT the same as an empty
 *  registry. A fetch failure must not read as "zero games": in reconcile() that
 *  turns every live route into false orphan drift (and, once reconcile heals,
 *  would delete every route). `[]` means the registry loaded and is genuinely
 *  empty; callers that just render tolerate `?? []`. */
export async function fetchRegistryItems(env: Env): Promise<RegistryGame[] | null> {
  const result = await readRegistry(env.GITHUB_TOKEN);
  return result.status === 'available' ? result.games : null;
}

export async function fetchRegistry(env: Env): Promise<GameConfig[]> {
  const items = (await fetchRegistryItems(env)) ?? [];
  return items.map(
    (item: RegistryGame): GameConfig => ({
      id: item.id,
      name: item.name || '',
      org: ORG,
      cfProject: (item.cfProject as string) || `free${item.id}app`,
      domain: `${item.id}.${DOMAIN}`,
      hostedOn: (item.hostedOn as string) || 'pages',
      status: registryState.readStatus(item),
    }),
  );
}

/** Raw registry items (keeps fields fetchRegistry() drops, e.g. creatorGithub)
 *  — backs the Users tab + creator stats. A fetch failure renders as empty here
 *  (best-effort read path); reconcile() uses fetchRegistryItems() directly so it
 *  can distinguish failure from empty. */
export async function fetchRegistryRaw(env: Env): Promise<RegistryGame[]> {
  return (await fetchRegistryItems(env)) ?? [];
}

export async function fetchQuality(): Promise<QualityData | null> {
  try {
    const res = await fetch(QUALITY_URL, { headers: { 'User-Agent': 'freegamestore-admin' } });
    if (!res.ok) return null;
    return (await res.json()) as QualityData;
  } catch {
    return null;
  }
}

export async function fetchGameStatus(game: GameConfig, env: Env) {
  // Path B (R2) games have no CF Pages project — querying one always 404s and
  // reports a bogus "no_project" error. Every current FGS game is on Path B,
  // so without this short-circuit the whole dashboard reads as broken.
  if (game.hostedOn === 'r2') {
    return {
      cf: {
        deploy: { status: 'r2', time: null, url: `https://${game.domain}`, error: null },
        domain: { status: 'active', cert: 'active', error: null },
        source: null,
      },
    };
  }
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/pages/projects/${game.cfProject}`,
      { headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` } },
    );
    const data = (await res.json()) as Record<string, unknown>;

    if (!data.success) {
      return {
        cf: {
          deploy: {
            status: 'no_project',
            time: null,
            url: null,
            error: `Project "${game.cfProject}" not found`,
          },
          domain: { status: 'unknown', cert: 'unknown', error: null },
          source: null,
        },
      };
    }

    const project = data.result as Record<string, unknown>;
    const lastDeploy = project.latest_deployment as Record<string, unknown> | undefined;
    const source = project.source as Record<string, unknown> | undefined;
    const domains = (project.domains as string[]) || [];
    const customDomain = domains.find((d: string) => d === game.domain);

    let deployError: string | null = null;
    const latestStage = lastDeploy
      ? (lastDeploy.latest_stage as Record<string, unknown> | undefined)
      : undefined;
    if (latestStage?.status === 'failure') {
      deployError = `${(latestStage.name as string) || 'Build'} failed`;
    }

    const deploymentTrigger = lastDeploy
      ? (lastDeploy.deployment_trigger as Record<string, unknown> | undefined)
      : undefined;
    const sourceConfig = source
      ? (source.config as Record<string, unknown> | undefined)
      : undefined;

    return {
      cf: {
        deploy: lastDeploy
          ? {
              status: (latestStage?.status as string) || 'unknown',
              time: lastDeploy.created_on as string | null,
              url: lastDeploy.url as string | null,
              error: deployError,
              trigger: (deploymentTrigger?.type as string) || 'unknown',
              commitMsg:
                (
                  (deploymentTrigger?.metadata as Record<string, unknown>)?.commit_message as string
                )?.slice(0, 60) || null,
            }
          : { status: 'none', time: null, url: null, error: 'No deployments yet' },
        domain: customDomain
          ? { status: 'active', cert: 'active', error: null }
          : { status: 'not_configured', cert: 'none', error: 'Custom domain not in project' },
        source: source
          ? {
              type: sourceConfig?.type as string | undefined,
              owner: sourceConfig?.owner as string | undefined,
              repo: sourceConfig?.repo_name as string | undefined,
              enabled: sourceConfig?.deployments_enabled as boolean | undefined,
            }
          : null,
      },
    };
  } catch (e) {
    return {
      cf: {
        deploy: { status: 'error', time: null, url: null, error: String(e) },
        domain: { status: 'error', cert: 'error', error: String(e) },
        source: null,
      },
    };
  }
}

export async function fetchAllStatus(env: Env) {
  const games = await fetchRegistry(env);
  const results = await Promise.all(
    games.map(async (game) => {
      const status = await fetchGameStatus(game, env);
      return { ...game, ...status };
    }),
  );
  return results;
}

export function dataService(env: Env) {
  return {
    registryItems: () => fetchRegistryItems(env),
    registry: () => fetchRegistry(env),
    registryRaw: () => fetchRegistryRaw(env),
    gameStatus: (game: GameConfig) => fetchGameStatus(game, env),
    allStatus: () => fetchAllStatus(env),
    quality: fetchQuality,
  };
}

export type DataService = ReturnType<typeof dataService>;
