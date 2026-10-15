/** Where the public games registry lives. The single source for both the
 * writer (publish.ts) and the reader (registryReader.ts). They must never
 * point at different repos or paths: a split is how provisioned games got
 * reconciled as orphans and their routes deleted (#213).
 *
 * The store repo is `platform`, not the archived `freegamestore` repo. */
export const REGISTRY_LOCATION = {
  org: 'freegamestore-online',
  repo: 'platform',
  path: 'sites/freegamestore/registry.json',
} as const;

export function registryContentsUrl(): string {
  const { org, repo, path } = REGISTRY_LOCATION;
  return `https://api.github.com/repos/${org}/${repo}/contents/${path}`;
}

export function registryRawUrl(): string {
  const { org, repo, path } = REGISTRY_LOCATION;
  return `https://raw.githubusercontent.com/${org}/${repo}/main/${path}`;
}
