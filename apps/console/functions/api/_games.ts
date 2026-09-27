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

import { validateId } from './_validate';

export const ORG = 'freegamestore-online';
const DOMAIN = 'freegamestore.online';
const REGISTRY_URL = `https://raw.githubusercontent.com/${ORG}/freegamestore/main/registry.json`;

export type RegistryReadResult =
  | { status: 'available'; games: RegistryGame[] }
  | { status: 'missing' }
  | { status: 'unavailable' };

/** Immutable snapshot written for new remixes (#44). String remains accepted
 * for #35-era registry records that cannot be safely reconstructed. */
export interface ForkAttribution {
  id: string;
  name: string;
  creatorGithub: string;
  forkedAt: string;
}
export type ForkedFrom = ForkAttribution | string;

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
  /** Engine/template the game was generated from (kaplay|phaser|3d|canvas|grid|cards). */
  engine?: string;
  /** Immutable remix lineage, or a legacy source id when facts are incomplete. */
  forkedFrom?: ForkedFrom;
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
  /** Immutable remix lineage, or a legacy source id when facts are incomplete. */
  forkedFrom?: ForkedFrom;
  /** True only while the source still has a registry entry. Consumers use this
   * to avoid turning an immutable, deleted-source credit into a dead link. */
  forkedFromSourceAvailable?: boolean;
}

interface GhEnv {
  GITHUB_TOKEN: string;
}

const ghHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'freegamestore-publisher',
});

const VALID_ID = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const VALID_GH_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

function isCanonicalId(id: string): boolean {
  return VALID_ID.test(id) && validateId(id) === null;
}

export interface OwnershipFacts {
  isCreator: boolean;
  isOrgMember: boolean;
  isLegacyAcceptedCollaborator: boolean;
}

/** Shared-contract facts; individual endpoints decide which facts authorize an operation. */
export function ownershipFacts(
  game: Pick<RegistryGame, 'creatorGithub'> | undefined,
  login: string,
  signals: Pick<OwnershipFacts, 'isOrgMember' | 'isLegacyAcceptedCollaborator'>,
): OwnershipFacts {
  const isCreator =
    !!game?.creatorGithub && game.creatorGithub.toLowerCase() === login.toLowerCase();
  return {
    isCreator,
    isOrgMember: signals.isOrgMember,
    isLegacyAcceptedCollaborator: !game?.creatorGithub && signals.isLegacyAcceptedCollaborator,
  };
}

function isForkAttribution(value: unknown): value is ForkAttribution {
  if (!value || typeof value !== 'object') return false;
  const attribution = value as Record<string, unknown>;
  return (
    typeof attribution.id === 'string' &&
    isCanonicalId(attribution.id) &&
    typeof attribution.name === 'string' &&
    attribution.name.trim().length > 0 &&
    typeof attribution.creatorGithub === 'string' &&
    VALID_GH_LOGIN.test(attribution.creatorGithub) &&
    typeof attribution.forkedAt === 'string' &&
    !Number.isNaN(Date.parse(attribution.forkedAt))
  );
}

/** Compatibility projection for #35 strings. It only returns a rich object if
 * the target's creation time and the source's current id/name/creator are all
 * present. Otherwise it preserves the bare id instead of fabricating credit. */
export function normalizeForkedFrom(
  value: unknown,
  registry: RegistryGame[],
  legacyForkedAt: unknown,
): ForkedFrom | undefined {
  if (isForkAttribution(value)) return value;
  if (typeof value !== 'string' || !VALID_ID.test(value)) return undefined;
  if (typeof legacyForkedAt !== 'string' || Number.isNaN(Date.parse(legacyForkedAt))) return value;
  const source = registry.find((game) => game.id === value);
  if (
    !source ||
    typeof source.name !== 'string' ||
    !source.name.trim() ||
    typeof source.creatorGithub !== 'string' ||
    !VALID_GH_LOGIN.test(source.creatorGithub)
  )
    return value;
  return {
    id: value,
    name: source.name.trim(),
    creatorGithub: source.creatorGithub,
    forkedAt: legacyForkedAt,
  };
}

/** Fetch the store registry (source of truth for games).
 *  Prefers the authenticated GitHub contents API, which is NOT CDN-cached, so a
 *  game created/edited seconds ago appears immediately. `raw.githubusercontent.com`
 *  (the fallback) is cached ~5min, which made fresh games and their just-saved
 *  settings look empty.
 *
 *  Returns `null` when EVERY attempt failed — which is NOT the same as an empty
 *  registry. Treating a fetch failure as "zero games" hides a creator's real
 *  games and mis-gates create (a re-provision of their own id 409s); callers
 *  must surface `null` as temporarily-unavailable instead. `[]` means the
 *  registry loaded and is genuinely empty. */
export async function getRegistryState(token?: string): Promise<RegistryReadResult> {
  let contentsMissing = false;
  if (token) {
    try {
      const res = await fetch(
        `https://api.github.com/repos/${ORG}/freegamestore/contents/registry.json`,
        {
          headers: { ...ghHeaders(token), Accept: 'application/vnd.github.raw+json' },
        },
      );
      if (res.ok) {
        const reg = (await res.json()) as { games?: RegistryGame[] };
        if (Array.isArray(reg.games)) return { status: 'available', games: reg.games };
      } else if (res.status === 404) {
        contentsMissing = true;
      }
    } catch {
      /* fall through to the raw CDN URL */
    }
  }
  try {
    const res = await fetch(REGISTRY_URL, { headers: { 'User-Agent': 'freegamestore-publisher' } });
    if (res.ok) {
      const reg = (await res.json()) as { games?: RegistryGame[] };
      if (Array.isArray(reg.games)) return { status: 'available', games: reg.games };
    } else if (res.status === 404 && contentsMissing) {
      return { status: 'missing' };
    }
  } catch {
    /* both attempts failed */
  }
  return { status: 'unavailable' };
}

/** Compatibility projection for existing routes; callers that need diagnostics use getRegistryState. */
export async function getRegistry(token?: string): Promise<RegistryGame[] | null> {
  const result = await getRegistryState(token);
  return result.status === 'available' ? result.games : null;
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

export function registryToRepo(
  g: RegistryGame,
  published: boolean,
  registry: RegistryGame[] = [],
): GameRepo {
  const forkedFrom = normalizeForkedFrom(g.forkedFrom, registry, g.firstPublished);
  const sourceId =
    typeof forkedFrom === 'string'
      ? forkedFrom
      : forkedFrom && typeof forkedFrom.id === 'string'
        ? forkedFrom.id
        : undefined;
  const forkedFromSourceAvailable = !!sourceId && registry.some((game) => game.id === sourceId);
  return {
    id: g.id,
    name: g.name || g.id.charAt(0).toUpperCase() + g.id.slice(1),
    previewUrl: g.appUrl || `https://${g.id}.${DOMAIN}`,
    liveUrl: g.appUrl || `https://${g.id}.${DOMAIN}`,
    repoUrl: g.repo ? `https://github.com/${g.repo}` : `https://github.com/${ORG}/${g.id}`,
    createdAt: g.firstPublished || '',
    updatedAt: g.updatedAt || '',
    lastEditedAt: '',
    published,
    category: g.category || '',
    icon: g.icon || '',
    iconBg: g.iconBg || '',
    description: g.description || '',
    ...(forkedFrom
      ? {
          forkedFrom,
          forkedFromSourceAvailable,
        }
      : {}),
  };
}

/** The repo's created_at + pushed_at — sources for the "created" (fallback) and
 *  "last edited" timestamps. Best-effort: nulls on any failure so the list still
 *  renders. One call feeds both timestamps. */
async function fetchRepoTimes(
  env: GhEnv,
  repoId: string,
): Promise<{ createdAt: string; pushedAt: string }> {
  try {
    const res = await fetch(`https://api.github.com/repos/${ORG}/${repoId}`, {
      headers: ghHeaders(env.GITHUB_TOKEN),
    });
    if (!res.ok) return { createdAt: '', pushedAt: '' };
    const j = (await res.json()) as { created_at?: string; pushed_at?: string };
    return { createdAt: j.created_at || '', pushedAt: j.pushed_at || '' };
  } catch {
    return { createdAt: '', pushedAt: '' };
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
 *
 * Org membership only grants the extra `adminAll` catalog view — it does NOT
 * make every game "theirs". Conflating the two zeroed out a member's create
 * slots (`remaining = max - catalog.length`) and blocked them from publishing,
 * so `owned` is always the member's OWN games by the same rule as everyone else.
 *
 * Throws `registry_unavailable` when the registry couldn't be fetched, so
 * callers surface a retryable error instead of pretending the creator has zero
 * games (which reads as data loss and mis-gates create).
 */
export async function listUserGames(
  env: GhEnv,
  login: string,
): Promise<{ owned: GameRepo[]; isOrgMember: boolean; adminAll: GameRepo[] }> {
  const [games, member] = await Promise.all([
    getRegistry(env.GITHUB_TOKEN),
    isOrgMember(env, login),
  ]);
  if (games === null) throw new Error('registry_unavailable');
  const adminAll = games.map((g) => registryToRepo(g, true, games));

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
        const res = await fetch(
          `https://api.github.com/repos/${ORG}/${g.id}/collaborators/${login}`,
          {
            headers: ghHeaders(env.GITHUB_TOKEN),
          },
        );
        if (res.status === 204) ownedIds.add(g.id);
      } catch {
        /* ignore — degrade to creatorGithub-only */
      }
    }),
  );

  const owned = games.filter((g) => ownedIds.has(g.id)).map((g) => registryToRepo(g, true, games));
  // Enrich the owned set (small — capped by the per-creator slot limit) with the
  // repo's last-push time + a created_at fallback for legacy games missing
  // firstPublished.
  await enrichTimes(env, owned);
  return { owned, isOrgMember: member, adminAll };
}
