/** Registry-primary ownership check (agent copy of the shared contract).
 *
 * A game is owned by its registry `creatorGithub` (case-insensitive). Org
 * members get an admin-all view. Legacy games with no recorded creatorGithub
 * fall back to an accepted-collaborator check. This mirrors the publisher's
 * `functions/api/_games.ts` and admin's provision/update guards — a vendored
 * copy, kept in sync by hand (workspace "vendor, don't depend" rule).
 */
import type { StoreConfig } from "./config";
import { resilientFetch } from "./ghfetch";

export interface RegistryGame {
  id: string;
  name?: string;
  creatorGithub?: string;
  developer?: string;
  appUrl?: string;
}

function gh(path: string, token: string, agentName: string): Promise<Response> {
  // resilientFetch adds a timeout + transient-failure retry but leaves the body
  // untouched, so the caller's `.status` checks (204 = member/collaborator) work
  // exactly as before.
  return resilientFetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": agentName,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
}

/** Look up a single game in the store registry by id. Null on miss/error. */
export async function fetchRegistryGame(config: StoreConfig, id: string): Promise<RegistryGame | null> {
  const url = `https://raw.githubusercontent.com/${config.org}/${config.storeRepo}/main/registry.json`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": config.agentName } });
    if (!res.ok) return null;
    const reg = (await res.json()) as Record<string, RegistryGame[] | undefined>;
    const games = reg[config.nounPlural] ?? [];
    return games.find((g) => g.id === id) ?? null;
  } catch {
    return null;
  }
}

/**
 * Does `login` own game `id`? A game must be in the registry to be ownable
 * (a repo with no registry entry is drift, not a game). Owner iff:
 *   - registry `creatorGithub === login` (case-insensitive), OR
 *   - `login` is an org member (admin-all view), OR
 *   - the game has NO recorded `creatorGithub` (legacy) AND `login` is an
 *     accepted collaborator on the repo.
 * Returns the registry entry too (null → game not found).
 */
export async function ownsGame(
  config: StoreConfig,
  token: string,
  id: string,
  login: string,
): Promise<{ owns: boolean; game: RegistryGame | null }> {
  const game = await fetchRegistryGame(config, id);
  if (!game) return { owns: false, game: null };

  const lc = login.toLowerCase();
  if (game.creatorGithub && game.creatorGithub.toLowerCase() === lc) {
    return { owns: true, game };
  }

  // Org member → admin-all.
  try {
    const m = await gh(`/orgs/${config.org}/members/${login}`, token, config.agentName);
    if (m.status === 204) return { owns: true, game };
  } catch {
    /* ignore — fall through */
  }

  // Legacy games with no recorded creator: accepted-collaborator check.
  if (!game.creatorGithub) {
    try {
      const c = await gh(`/repos/${config.org}/${id}/collaborators/${login}`, token, config.agentName);
      if (c.status === 204) return { owns: true, game };
    } catch {
      /* ignore */
    }
  }

  return { owns: false, game };
}
