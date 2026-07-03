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
  icon?: string;
  iconBg?: string;
  description?: string;
  appUrl?: string;
  repo?: string;
  creatorGithub?: string;
  developer?: string;
  firstPublished?: string;
  updatedAt?: string;
}

export interface GameRepo {
  id: string;
  name: string;
  previewUrl: string;
  liveUrl: string;
  repoUrl: string;
  createdAt: string;
  /** Registry metadata edit time (name/description/icon/…). */
  updatedAt: string;
  /** Last code change — the repo's GitHub pushed_at (populated for owned games). */
  lastEditedAt: string;
  published: boolean;
  category: string;
  icon: string;
  iconBg: string;
  description: string;
}

interface GhEnv {
  GITHUB_TOKEN: string;
}

const ghHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "freegamestore-publisher",
});

/** Fetch the store registry (source of truth for games). Empty on failure.
 *  Prefers the authenticated GitHub contents API, which is NOT CDN-cached, so a
 *  game created/edited seconds ago appears immediately. `raw.githubusercontent.com`
 *  (the fallback) is cached ~5min, which made fresh games and their just-saved
 *  settings look empty. Falls back to the raw URL if the token call fails. */
export async function getRegistry(token?: string): Promise<RegistryGame[]> {
  if (token) {
    try {
      const res = await fetch(`https://api.github.com/repos/${ORG}/freegamestore/contents/registry.json`, {
        headers: { ...ghHeaders(token), Accept: "application/vnd.github.raw+json" },
      });
      if (res.ok) {
        const reg = (await res.json()) as { games?: RegistryGame[] };
        return reg.games ?? [];
      }
    } catch {
      /* fall through to the raw CDN URL */
    }
  }
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
    updatedAt: g.updatedAt || "",
    lastEditedAt: "",
    published,
    category: g.category || "",
    icon: g.icon || "",
    iconBg: g.iconBg || "",
    description: g.description || "",
  };
}

/** The repo's created_at + pushed_at — sources for the "created" (fallback) and
 *  "last edited" timestamps. Best-effort: nulls on any failure so the list still
 *  renders. One call feeds both timestamps. */
async function fetchRepoTimes(env: GhEnv, repoId: string): Promise<{ createdAt: string; pushedAt: string }> {
  try {
    const res = await fetch(`https://api.github.com/repos/${ORG}/${repoId}`, { headers: ghHeaders(env.GITHUB_TOKEN) });
    if (!res.ok) return { createdAt: "", pushedAt: "" };
    const j = (await res.json()) as { created_at?: string; pushed_at?: string };
    return { createdAt: j.created_at || "", pushedAt: j.pushed_at || "" };
  } catch {
    return { createdAt: "", pushedAt: "" };
  }
}

/** Fill `lastEditedAt` (repo pushed_at) and, when the registry has no
 *  firstPublished, `createdAt` (repo created_at) for a set of games. One repo
 *  fetch per game, run in parallel. Capped so the org-member admin-all view
 *  (potentially the whole catalog) can't fan out unbounded. */
const ENRICH_CAP = 100;
async function enrichTimes(env: GhEnv, games: GameRepo[]): Promise<void> {
  await Promise.all(
    games.slice(0, ENRICH_CAP).map(async (game) => {
      const { createdAt, pushedAt } = await fetchRepoTimes(env, game.id);
      game.lastEditedAt = pushedAt;
      if (!game.createdAt) game.createdAt = createdAt;
    }),
  );
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
  const [games, member] = await Promise.all([getRegistry(env.GITHUB_TOKEN), isOrgMember(env, login)]);
  const adminAll = games.map((g) => registryToRepo(g, true));
  if (member) {
    // Org members get the admin-all view — but they still need real timestamps.
    // (This was the gap: the enrichment used to run only on the non-member path,
    // so a member never saw a "last edited" time.)
    await enrichTimes(env, adminAll);
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
  // Enrich the owned set (small — capped by the per-creator slot limit) with the
  // repo's last-push time + a created_at fallback for legacy games missing
  // firstPublished.
  await enrichTimes(env, owned);
  return { owned, isOrgMember: false, adminAll };
}
