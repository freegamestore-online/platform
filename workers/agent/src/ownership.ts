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

function gh(path: string, token: string, agentName: string, accept = "application/vnd.github+json"): Promise<Response> {
  // resilientFetch adds a timeout + transient-failure retry but leaves the body
  // untouched, so the caller's `.status` checks (204 = member/collaborator) work
  // exactly as before.
  return resilientFetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: accept,
      "User-Agent": agentName,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
}

/** The registry or a GitHub ownership probe could not be read. Distinct from
 *  "no such game" / "not yours": callers must surface it as an upstream
 *  failure, never as an authoritative denial (#40). */
export class OwnershipLookupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OwnershipLookupError";
  }
}

/** Fetch the store registry games array (source of truth).
 *  Prefers the authenticated GitHub contents API, which is NOT CDN-cached, so a
 *  game provisioned seconds ago appears immediately. `raw.githubusercontent.com`
 *  (the fallback) is edge-cached ~5min, which made a just-provisioned game look
 *  "not found" and un-editable by its own creator for minutes. Mirrors the
 *  publisher's `_games.ts getRegistry` (vendored copy, kept in sync by hand).
 *  Throws OwnershipLookupError when EVERY attempt failed. */
async function fetchRegistry(config: StoreConfig, token: string): Promise<RegistryGame[]> {
  const failures: string[] = [];
  // Authenticated contents API — uncached. Accept: raw returns the file body
  // directly (not the base64-wrapped metadata envelope).
  try {
    const res = await gh(
      `/repos/${config.org}/${config.storeRepo}/contents/registry.json`,
      token,
      config.agentName,
      "application/vnd.github.raw+json",
    );
    if (res.ok) {
      const reg = (await res.json()) as Record<string, RegistryGame[] | undefined>;
      return reg[config.nounPlural] ?? [];
    }
    failures.push(`contents API ${res.status}`);
  } catch (e) {
    failures.push(`contents API ${e instanceof Error ? e.message : String(e)}`);
  }
  // Fallback: the CDN-cached raw URL (no token needed).
  try {
    const url = `https://raw.githubusercontent.com/${config.org}/${config.storeRepo}/main/registry.json`;
    const res = await fetch(url, { headers: { "User-Agent": config.agentName } });
    if (res.ok) {
      const reg = (await res.json()) as Record<string, RegistryGame[] | undefined>;
      return reg[config.nounPlural] ?? [];
    }
    failures.push(`raw ${res.status}`);
  } catch (e) {
    failures.push(`raw ${e instanceof Error ? e.message : String(e)}`);
  }
  throw new OwnershipLookupError(`store registry unavailable (${failures.join("; ")})`);
}

/** Look up a single game in the store registry by id. Null only when the
 *  registry was read and has no such game; throws OwnershipLookupError when
 *  the registry could not be read. */
export async function fetchRegistryGame(config: StoreConfig, token: string, id: string): Promise<RegistryGame | null> {
  const games = await fetchRegistry(config, token);
  return games.find((g) => g.id === id) ?? null;
}

/** 204 → yes, 404 → no; anything else (auth, outage, network) throws, so a
 *  failed probe is never read as "not a member / not a collaborator". */
async function probe(path: string, token: string, agentName: string, what: string): Promise<boolean> {
  let res: Response;
  try {
    res = await gh(path, token, agentName);
  } catch (e) {
    throw new OwnershipLookupError(`${what} check failed (${e instanceof Error ? e.message : String(e)})`);
  }
  if (res.status === 204) return true;
  if (res.status === 404) return false;
  throw new OwnershipLookupError(`${what} check failed (${res.status})`);
}

/**
 * Does `login` own game `id`? A game must be in the registry to be ownable
 * (a repo with no registry entry is drift, not a game). Owner iff:
 *   - registry `creatorGithub === login` (case-insensitive), OR
 *   - `login` is an org member (admin-all view), OR
 *   - the game has NO recorded `creatorGithub` (legacy) AND `login` is an
 *     accepted collaborator on the repo.
 * Returns the registry entry too (null → game confirmed absent from the
 * registry). Throws OwnershipLookupError if the registry or a probe failed.
 */
export async function ownsGame(
  config: StoreConfig,
  token: string,
  id: string,
  login: string,
): Promise<{ owns: boolean; game: RegistryGame | null }> {
  const game = await fetchRegistryGame(config, token, id);
  if (!game) return { owns: false, game: null };

  const lc = login.toLowerCase();
  if (game.creatorGithub && game.creatorGithub.toLowerCase() === lc) {
    return { owns: true, game };
  }

  // Org member → admin-all.
  if (await probe(`/orgs/${config.org}/members/${login}`, token, config.agentName, "org membership")) {
    return { owns: true, game };
  }

  // Legacy games with no recorded creator: accepted-collaborator check.
  if (!game.creatorGithub) {
    if (await probe(`/repos/${config.org}/${id}/collaborators/${login}`, token, config.agentName, "collaborator")) {
      return { owns: true, game };
    }
  }

  return { owns: false, game };
}
