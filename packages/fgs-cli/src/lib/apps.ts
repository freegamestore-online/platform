/**
 * Canonical mapping for games published on freegamestore.online.
 *
 * Most games follow the convention `app_id` → CF Pages project `free<id>app`,
 * which is what we infer when an entry isn't here. The CF Pages project name
 * is NOT renameable after creation, so non-conventional projects need an
 * override entry below.
 *
 * Same naming convention as fas-cli's APPS map (intentional — both stores
 * deploy through the same Cloudflare account, so project namespaces overlap
 * and most projects follow `free<id>app`). The DIFFERENCE is the subdomain
 * — games live under `*.freegamestore.online`. Previously this file was a
 * verbatim copy of fas-cli/src/lib/apps.ts and silently routed `fgs logs` /
 * `fgs publish` / `fgs list` at the wrong store.
 *
 * Long-term this should fetch the storefront's registry.json at runtime so
 * adding a new non-conventional game doesn't require a CLI bump. For now,
 * keep the override list small — convention-following games don't need
 * entries.
 */
export interface AppRecord {
  cfProject: string;
  subdomain: string;
}

export const APPS: Record<string, AppRecord> = {
  // Non-conventional CF project names. Add an entry only when the project
  // can't be renamed and doesn't follow `free<id>app`.
  puzzle: { cfProject: 'freepuzzle', subdomain: 'puzzle.freegamestore.online' },
};

/**
 * Returns the CF Pages project name for a game id. Prefers the registry,
 * falls back to the `free<id>app` convention used by every game except
 * the legacy entries above.
 */
export function cfProjectFor(appId: string): string {
  return APPS[appId]?.cfProject ?? `free${appId}app`;
}

/**
 * Returns the public URL for a game id.
 */
export function urlFor(appId: string): string {
  const subdomain = APPS[appId]?.subdomain ?? `${appId}.freegamestore.online`;
  return `https://${subdomain}`;
}
