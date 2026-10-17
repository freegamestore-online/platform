import type { Step } from './publish';

// Publish-time provisioning of a Cloudflare Web Analytics (RUM) beacon token for
// each game (#353). Ported from freeappstore-online/platform's
// provisionCfWebAnalytics (FAS#8 made auth/API errors non-fatal; the same rule
// applies here).
//
// The token lands in the `game_analytics` row that the host worker's loader
// reads (workers/host/src/analytics.ts). Admin and host share the `freegamestore`
// D1, so this is a direct write, not a service call.

export interface AnalyticsProvisionEnv {
  CF_ACCOUNT_ID: string;
  CF_API_TOKEN: string;
  DB: D1Database;
}

const STEP_NAME = 'CF Web Analytics';
const CF_API = 'https://api.cloudflare.com/client/v4';
// Same shape the host loader and the static site accept for a beacon token.
const SITE_TAG_RE = /^[a-f0-9]{32,}$/i;
const LIST_PAGE_SIZE = 100;
const LIST_MAX_PAGES = 10;

interface CfEnvelope<T> {
  success?: boolean;
  result?: T;
  errors?: Array<{ message?: string }>;
}

interface RumSite {
  host?: string;
  site_tag?: string;
}

/** Calls the CF API and throws with CF's own message on any non-success response. */
async function cfCall<T>(
  env: AnalyticsProvisionEnv,
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${CF_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as CfEnvelope<T> | null;
  if (!res.ok || json?.success !== true) {
    throw new Error(
      json?.errors?.[0]?.message ?? `CF ${method} ${path} failed (HTTP ${res.status})`,
    );
  }
  return json.result as T;
}

/** Scans the account's RUM sites for one whose host matches. Bounded paging so a
 *  large account can't turn one publish into an unbounded fan-out of calls. */
async function findRumSiteTag(
  env: AnalyticsProvisionEnv,
  host: string,
): Promise<string | undefined> {
  for (let page = 1; page <= LIST_MAX_PAGES; page++) {
    const sites = await cfCall<RumSite[]>(
      env,
      `/accounts/${env.CF_ACCOUNT_ID}/rum/site_info/list?page=${page}&per_page=${LIST_PAGE_SIZE}`,
    );
    const match = sites.find((s) => s.host === host);
    if (match?.site_tag) return match.site_tag;
    if (sites.length < LIST_PAGE_SIZE) break;
  }
  return undefined;
}

/** Provisions (or reuses) the RUM beacon token for `gameId` and stores it on its
 *  `game_analytics` row. Never throws and never returns `fail`, so a broken CF
 *  token, a CF outage or a D1 hiccup cannot block a publish. The caller decides
 *  what to do with the step; provisionGameAnalytics is only ever reported as ok
 *  or skip. */
export async function provisionGameAnalytics(
  env: AnalyticsProvisionEnv,
  gameId: string,
  host: string,
): Promise<Step> {
  const skip = (detail: string): Step => ({
    name: STEP_NAME,
    status: 'skip',
    detail: `(non-fatal) ${detail}`,
  });
  try {
    const existing = await env.DB.prepare(
      'SELECT cf_beacon_token FROM game_analytics WHERE game_id = ?1',
    )
      .bind(gameId)
      .first<{ cf_beacon_token: string | null }>();
    if (existing?.cf_beacon_token && SITE_TAG_RE.test(existing.cf_beacon_token)) {
      return {
        name: STEP_NAME,
        status: 'skip',
        detail: `Beacon token already provisioned for ${host}`,
      };
    }

    let siteTag = await findRumSiteTag(env, host);
    const created = siteTag === undefined;
    if (created) {
      // auto_install: false — the token is injected by the platform loader, not by
      // CF's own snippet injection, so the site must not also auto-inject.
      const site = await cfCall<RumSite>(
        env,
        `/accounts/${env.CF_ACCOUNT_ID}/rum/site_info`,
        'POST',
        {
          host,
          auto_install: false,
        },
      );
      siteTag = site.site_tag;
    }
    if (!siteTag || !SITE_TAG_RE.test(siteTag)) {
      return skip(`CF returned no usable site tag for ${host}`);
    }

    try {
      await env.DB.prepare(
        `INSERT INTO game_analytics (game_id, cf_beacon_token, updated_at) VALUES (?1, ?2, ?3)
           ON CONFLICT (game_id) DO UPDATE SET
             cf_beacon_token = excluded.cf_beacon_token,
             updated_at = excluded.updated_at`,
      )
        .bind(gameId, siteTag, Date.now())
        .run();
    } catch (err) {
      // The RUM site now exists, so the next publish finds it via the list and
      // retries only this write.
      const message = err instanceof Error ? err.message : String(err);
      return skip(`minted beacon token for ${host} but storing it failed: ${message}`);
    }

    return created
      ? {
          name: STEP_NAME,
          status: 'ok',
          detail: `Minted RUM site for ${host} and stored its beacon token`,
        }
      : {
          name: STEP_NAME,
          status: 'skip',
          detail: `RUM site already exists for ${host}; beacon token stored`,
        };
  } catch (err) {
    return skip(err instanceof Error ? err.message : String(err));
  }
}
