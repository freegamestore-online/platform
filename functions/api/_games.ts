// Ownership + game-listing contract (registry-primary).
//
// A game is owned by its registry `creatorGithub`, matched case-insensitively.
// The registry entry is written at provision time — BEFORE an outside
// collaborator accepts their GitHub invite — so this surfaces a freshly created
// game immediately, without the pending-invite blind spot that a GitHub
// collaborator scan has. Org members get an admin-all view.
//
// This is a shared CONTRACT, not a shared module: the same rule is enforced in
// admin (edit/provision guards) and the agent (import gate). Per the workspace
// "vendor, don't depend" rule those are separate copies; keep them in sync.

export const ORG = "freegamestore-online";
const DOMAIN = "freegamestore.online";
const REGISTRY_URL = `https://raw.githubusercontent.com/${ORG}/freegamestore/main/registry.json`;

export interface RegistryGame {
  id: string;
  name?: string;
  category?: string;
  appUrl?: string;
  repo?: string;
  creatorGithub?: string;
  developer?: string;
  firstPublished?: string;
}

export interface GameRepo {
  id: string;
  name: string;
  previewUrl: string;
  liveUrl: string;
  repoUrl: string;
  createdAt: string;
  published: boolean;
}

interface GhEnv {
  GITHUB_TOKEN: string;
}

const ghHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "freegamestore-publisher",
});

/** Fetch the store registry (source of truth for games). Empty on failure. */
export async function getRegistry(): Promise<RegistryGame[]> {
  try {
    const res = await fetch(REGISTRY_URL, { headers: { "User-Agent": "freegamestore-publisher" } });
    if (res.ok) {
      const reg = (await res.json()) as { games?: RegistryGame[] };
      return reg.games ?? [];
    }
  } catch {
    /* unreachable → treat as empty */
  }
  return [];
}

/** True if `login` is a member of the org (→ admin-all view). */
export async function isOrgMember(env: GhEnv, login: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.github.com/orgs/${ORG}/members/${login}`, {
      headers: ghHeaders(env.GITHUB_TOKEN),
    });
    return res.status === 204;
  } catch {
    return false;
  }
}

export function registryToRepo(g: RegistryGame, published: boolean): GameRepo {
  return {
    id: g.id,
    name: g.name || g.id.charAt(0).toUpperCase() + g.id.slice(1),
    previewUrl: g.appUrl || `https://${g.id}.${DOMAIN}`,
    liveUrl: g.appUrl || `https://${g.id}.${DOMAIN}`,
    repoUrl: g.repo ? `https://github.com/${g.repo}` : `https://github.com/${ORG}/${g.id}`,
    createdAt: g.firstPublished || "",
    published,
  };
}

/**
 * The ownership contract. Returns the games a user owns, whether they're an org
 * member, and the admin-all list. `owned` =
 *   - registry games with `creatorGithub === login` (case-insensitive), PLUS
 *   - legacy games with NO `creatorGithub` where the user is an accepted
 *     collaborator (this candidate set shrinks to zero after the creatorGithub
 *     backfill, so steady-state cost is a single registry fetch + membership
 *     check — no per-repo scan).
 * Org members get every registry game (admin view).
 */
export async function listUserGames(
  env: GhEnv,
  login: string,
): Promise<{ owned: GameRepo[]; isOrgMember: boolean; adminAll: GameRepo[] }> {
  const [games, member] = await Promise.all([getRegistry(), isOrgMember(env, login)]);
  const adminAll = games.map((g) => registryToRepo(g, true));
  if (member) {
    return { owned: adminAll, isOrgMember: true, adminAll };
  }

  const lc = login.toLowerCase();
  const ownedIds = new Set<string>();
  for (const g of games) {
    if (g.creatorGithub && g.creatorGithub.toLowerCase() === lc) ownedIds.add(g.id);
  }

  // Legacy safety net: games with no recorded creatorGithub — check accepted
  // collaboration (bounded to this shrinking set, not all org repos).
  const legacy = games.filter((g) => !g.creatorGithub && !ownedIds.has(g.id));
  await Promise.all(
    legacy.map(async (g) => {
      try {
        const res = await fetch(`https://api.github.com/repos/${ORG}/${g.id}/collaborators/${login}`, {
          headers: ghHeaders(env.GITHUB_TOKEN),
        });
        if (res.status === 204) ownedIds.add(g.id);
      } catch {
        /* ignore — degrade to creatorGithub-only */
      }
    }),
  );

  const owned = games.filter((g) => ownedIds.has(g.id)).map((g) => registryToRepo(g, true));
  return { owned, isOrgMember: false, adminAll };
}
