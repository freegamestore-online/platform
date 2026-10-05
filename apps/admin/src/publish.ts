import { readRegistry } from './registryReader';

// Publish API -- provisions a new game on FreeGameStore via Path B.
// POST /api/provision
// Body: { id, name, category, icon, iconBg, description, type?, creatorGithub? }
//
// Path B (since 2026-05-28): instead of creating a CF Pages project, this
// writes a row to the FGS-owned `freegamestore` D1 `routes` table (split off the
// formerly-shared `fas` DB on 2026-07-05). The fgs/host Worker
// (`*.freegamestore.online/*`) reads that table and serves from
// `r2://fgs-games/games/<slug>/`. The per-game GH Actions deploy.yml
// (in template-game-canvas) syncs build output to the right R2 prefix on
// every push to main.
//
// Why: 100-project/account CF Pages cap doesn't scale for free side.

/** Runtime bindings consumed by the GitHub/D1 lifecycle implementation. */
export interface PublishEnv {
  CF_ACCOUNT_ID: string;
  CF_API_TOKEN: string;
  GITHUB_TOKEN: string;
  DB: D1Database;
  /** Service binding to the agent worker + shared secret — used on delete to
   *  purge the agent-owned session index (agent_sessions lives in the agent's
   *  D1, not this worker's). Optional so provisioning works without them. */
  AGENT?: Fetcher;
  INTERNAL_TOKEN?: string;
}

/** Input accepted by the provision lifecycle operation. */
export interface PublishRequest {
  /** Slug / subdomain. Optional — derived from `name` when the CLI omits it. */
  id?: string;
  name: string;
  category: string;
  /** Optional — defaults applied when the CLI omits them. */
  icon?: string;
  iconBg?: string;
  description?: string;
  /** CLI sends a short tagline as `oneliner`; used as description if description absent. */
  oneliner?: string;
  type?: string;
  creatorGithub?: string;
  /** Engine/starter key (kaplay|phaser|3d|pixi|babylon|excalibur|littlejs|canvas|grid|cards). Defaults to canvas. */
  template?: string;
  /** Remix: id of an existing published game to seed this one from (all free
   *  games are MIT). The new game inherits the source's engine and its web/src
   *  code is copied over the fresh template infra. */
  cloneFrom?: string;
}

// Starter templates the creator can pick from. Maps the short key the Dashboard
// sends to the actual template repo generated from. Unknown/absent → canvas.
const TEMPLATE_REPOS: Record<string, string> = {
  canvas: 'template-game-canvas',
  grid: 'template-game-grid',
  cards: 'template-game-cards',
  // The three headline engines the Dashboard offers ("build on"):
  kaplay: 'template-game-kaplay', // beginner-friendly 2D arcade engine
  phaser: 'template-game-phaser', // production-grade 2D engine
  '3d': 'template-game-3d', // Three.js + react-three-fiber (3D)
  pixi: 'template-game-pixi', // Pixi.js v8 — WebGL 2D
  babylon: 'template-game-babylon', // Babylon.js v9 — advanced 3D
  excalibur: 'template-game-excalibur', // Excalibur — TS-native actor-based 2D
  littlejs: 'template-game-littlejs', // LittleJS — tiny all-in-one arcade (particles+sfx built in)
};

/** Lowercase a display name into a valid slug (matches validateId rules). */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 58);
}

/** Canonical category: lowercase, spaces→hyphens (PLATFORM-ISSUES C). The
 *  storefront mixes `casual`/`Casual`/`Brain Training` otherwise, a trap for any
 *  case-sensitive filter. Empty → the default. */
function normalizeCategory(cat?: string): string {
  const c = (cat ?? '').trim().toLowerCase().replace(/\s+/g, '-');
  return c || 'casual';
}

/** Display name for the registry (PLATFORM-ISSUES D). When the caller passes a
 *  slug-shaped name (equals the id, or all-lowercase-hyphenated), the store would
 *  show the raw slug as the title — so title-case it. A real title (has caps or
 *  spaces) is left untouched. */
function displayName(name: string, id: string): string {
  const n = name.trim();
  const slugShaped = n === id || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(n);
  if (!slugShaped) return n;
  return n
    .split(/[-\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Fields a creator may edit, and the limits PATCH enforces on them (#65). */
const EDITABLE_FIELDS = ['name', 'description', 'category', 'icon', 'iconBg'] as const;
type EditableField = (typeof EDITABLE_FIELDS)[number];
const MAX_NAME = 60;
const MAX_DESCRIPTION = 300;
const MAX_CATEGORY = 32;
const MAX_ICON = 24; // an emoji (incl. ZWJ sequences) or an HTML entity like &#128290;
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const CATEGORY_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Validate and normalize a metadata PATCH the way provisioning normalizes a new
 * game (#65). PATCH used to copy any string straight into registry.json: an
 * empty name/description made the storefront build DROP the game from the store
 * and search, a "Brain Training" category reintroduced the mixed-case problem
 * provisioning normalizes away, and values had no length limit. Only the fields
 * present in `updates` are checked; absent fields are left as they are.
 */
export function validateGameUpdates(
  updates: Record<string, unknown>,
  gameId: string,
): { values: Partial<Record<EditableField, string>> } | { error: string } {
  const values: Partial<Record<EditableField, string>> = {};
  for (const key of EDITABLE_FIELDS) {
    if (!(key in updates)) continue;
    const raw = updates[key];
    if (typeof raw !== 'string') return { error: `${key} must be a string` };
    const v = raw.trim();
    if (!v) return { error: `${key} can't be empty` };
    switch (key) {
      case 'name':
        if (v.length > MAX_NAME) return { error: `name must be ${MAX_NAME} characters or less` };
        values.name = displayName(v, gameId);
        break;
      case 'description':
        if (v.length > MAX_DESCRIPTION)
          return { error: `description must be ${MAX_DESCRIPTION} characters or less` };
        values.description = v;
        break;
      case 'category': {
        const c = normalizeCategory(v);
        if (c.length > MAX_CATEGORY || !CATEGORY_SLUG.test(c))
          return { error: 'category must be letters, numbers and dashes (e.g. "brain-training")' };
        values.category = c;
        break;
      }
      case 'icon':
        if (v.length > MAX_ICON) return { error: `icon must be ${MAX_ICON} characters or less` };
        values.icon = v;
        break;
      case 'iconBg':
        if (!HEX_COLOR.test(v)) return { error: 'iconBg must be a hex colour like #ecfdf5' };
        values.iconBg = v;
        break;
    }
  }
  return { values };
}

export interface Step {
  name: string;
  status: 'ok' | 'skip' | 'fail';
  detail: string;
}

/** Build lifecycle of a registry entry (#22).
 *
 *  - `pending` — provisioned, but no deploy.yml run has concluded success yet.
 *    The repo, host route and registry entry all exist; the host serves the
 *    template scaffold. NOT live, however cheerfully it answers 200.
 *  - `live`    — at least one deploy.yml run concluded success. STICKY: a later
 *    failed build does not un-ship a game, because R2 still serves the last good
 *    artifact. Marking it `failed` would delist a working game.
 *  - `failed`  — has never built successfully and the latest attempt failed.
 *
 *  An ABSENT status means the entry predates this field (added 2026-08-11). Every
 *  such game is genuinely live, so readers treat missing as `live` and writers
 *  never downgrade it. Do not backfill by probing — the probe is what lies. */
export type GameStatus = 'pending' | 'live' | 'failed';

/** Immutable attribution captured when a game is remixed.  `name` and
 * `creatorGithub` are deliberately denormalised: an original can later be
 * renamed or delisted without erasing the credit on its descendants. */
export interface ForkAttribution {
  id: string;
  name: string;
  creatorGithub: string;
  forkedAt: string;
}

/** Legacy #35 entries used a source id string. Readers retain that form when
 * there is not enough trustworthy registry data to upgrade it. */
export type ForkedFrom = ForkAttribution | string;

/** Missing → `live` (legacy entry). Anything unrecognised is treated as legacy
 *  too rather than hiding a game on a typo. */
export function readGameStatus(entry: { status?: unknown } | null | undefined): GameStatus {
  const s = entry?.status;
  return s === 'pending' || s === 'failed' || s === 'live' ? s : 'live';
}

const STORE_CONFIG = {
  org: 'freegamestore-online',
  domain: 'freegamestore.online',
  storeRepo: 'platform',
  storeRegistryPath: 'sites/freegamestore/registry.json',
  registryKey: 'games',
  developer: 'FreeGameStore',
  templateRepo: 'template-game-canvas',
  r2Bucket: 'fgs-games',
};

async function ghApi(env: PublishEnv, path: string, method = 'GET', body?: any) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'freegamestore-admin',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  // Some endpoints (e.g. PUT collaborators when the user already has access)
  // return 204 No Content — an empty body. Don't crash res.json() on it; expose
  // the status so callers can branch (the collaborator step relies on this).
  const text = await res.text();
  let json: any = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { __raw: text };
    }
  }
  json.__status = res.status;
  return json;
}

// Reserved / infrastructure repos that must NEVER be targetable as a game id.
// admin's /api/provision is the shared chokepoint — the agent + MCP + CLI all
// funnel through it, some via the trusted internal token. Without this guard a
// caller could provision `freegamestore`, `submissions`, `template-game-*`, etc.,
// become its registry owner, and later delete/archive the real infra repo through
// the ownership-checked delete path. Mirrors the publisher's create.ts list.
const INFRA_REPOS = new Set([
  'freegamestore',
  'submissions',
  'template-game-canvas',
  'template-game-3d',
  'template-game-grid',
  'template-game-cards',
  'template-game-kaplay',
  'template-game-phaser',
  'template-game-pixi',
  'template-game-babylon',
  'template-game-excalibur',
  'template-game-littlejs',
  'brand',
  'ops',
  'sdk',
]);

export function validateId(id: string): string | null {
  if (!id) return 'ID is required';
  if (id.length < 3) return 'ID must be at least 3 characters';
  if (id.length > 58) return 'ID must be 58 characters or less';
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(id))
    return 'ID must be lowercase letters, numbers, and dashes only. Cannot start/end with a dash.';
  if (id.startsWith('free') || id.startsWith('pro'))
    return "ID must not start with 'free' or 'pro'";
  // Reject any reserved infra id (exact match) plus every template-game-* variant
  // so a new template can't be squatted before its constant is added here.
  if (INFRA_REPOS.has(id) || id.startsWith('template-game-')) return 'ID is reserved';
  return null;
}

// GitHub username grammar. `creatorGithub` is attacker-influenced (interpolated
// into a privileged github.com path + written to the registry as the ownership
// key), so an invalid value must abort the whole provision — never be persisted.
const VALID_GH_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

export interface OwnershipFacts {
  isCreator: boolean;
  isOrgMember: boolean;
  isLegacyAcceptedCollaborator: boolean;
}

/** Shared-contract facts; admin operations choose their own authorization policy. */
export function ownershipFacts(
  game: { creatorGithub?: unknown } | undefined,
  login: string,
  signals: Pick<OwnershipFacts, 'isOrgMember' | 'isLegacyAcceptedCollaborator'>,
): OwnershipFacts {
  const creator = typeof game?.creatorGithub === 'string' ? game.creatorGithub : '';
  return {
    isCreator: !!creator && creator.toLowerCase() === login.toLowerCase(),
    isOrgMember: signals.isOrgMember,
    isLegacyAcceptedCollaborator: !creator && signals.isLegacyAcceptedCollaborator,
  };
}

function isForkAttribution(value: unknown): value is ForkAttribution {
  if (!value || typeof value !== 'object') return false;
  const attribution = value as Record<string, unknown>;
  return (
    typeof attribution.id === 'string' &&
    !validateId(attribution.id) &&
    typeof attribution.name === 'string' &&
    attribution.name.trim().length > 0 &&
    typeof attribution.creatorGithub === 'string' &&
    VALID_GH_LOGIN.test(attribution.creatorGithub) &&
    typeof attribution.forkedAt === 'string' &&
    !Number.isNaN(Date.parse(attribution.forkedAt))
  );
}

/** Build a snapshot only from fields which the source registry actually
 * contains. Returning undefined rather than inventing a name, creator, or
 * timestamp is the compatibility rule for legacy lineage. */
function snapshotForkAttribution(
  sourceId: string,
  source: Record<string, unknown> | undefined,
  forkedAt: unknown,
): ForkAttribution | undefined {
  if (
    !source ||
    source.id !== sourceId ||
    typeof source.name !== 'string' ||
    !source.name.trim() ||
    typeof source.creatorGithub !== 'string' ||
    !VALID_GH_LOGIN.test(source.creatorGithub) ||
    typeof forkedAt !== 'string' ||
    Number.isNaN(Date.parse(forkedAt))
  ) {
    return undefined;
  }
  return {
    id: sourceId,
    name: source.name.trim(),
    creatorGithub: source.creatorGithub,
    forkedAt,
  };
}

/**
 * Present old string lineage as rich attribution only when the registry has all
 * four facts: the old target's creation timestamp plus the source id, name and
 * creator. Otherwise leave the string intact; guessing would make a mutable
 * source look like an immutable historical credit.
 */
export function normalizeForkedFrom(
  value: unknown,
  registry: Array<Record<string, unknown>>,
  legacyForkedAt: unknown,
): ForkedFrom | undefined {
  if (isForkAttribution(value)) return value;
  if (typeof value !== 'string' || validateId(value)) return undefined;
  return (
    snapshotForkAttribution(
      value,
      registry.find((entry) => entry.id === value),
      legacyForkedAt,
    ) ?? value
  );
}

/** Freeze safely-upgradable #35 records the next time a registry write already
 * occurs. Entries without all source facts deliberately remain legacy strings. */
function migrateLegacyForkAttribution(items: Array<Record<string, unknown>>): boolean {
  let changed = false;
  for (const item of items) {
    const normalized = normalizeForkedFrom(item.forkedFrom, items, item.firstPublished);
    if (normalized && typeof normalized !== 'string' && item.forkedFrom !== normalized) {
      item.forkedFrom = normalized;
      changed = true;
    }
  }
  return changed;
}

/** Write the D1 routes row that fgs/host reads to map host → R2 prefix.
 *  Idempotent via ON CONFLICT DO UPDATE — re-publishing the same id is a
 *  no-op for routing. r2_prefix follows the convention `games/<id>` which
 *  matches what the template's deploy.yml uploads to in fgs-games. */
export async function insertHostRoute(env: PublishEnv, slug: string): Promise<Step> {
  const r2Prefix = `${STORE_CONFIG.registryKey}/${slug}`;
  const now = Date.now();
  if (!env.DB) {
    return { name: 'Hosting route', status: 'fail', detail: 'D1 binding not available' };
  }
  try {
    await env.DB.prepare(
      `INSERT INTO routes (slug, zone, r2_prefix, store, hosted_on, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'r2', ?5, ?5)
         ON CONFLICT (slug, zone) DO UPDATE SET
           r2_prefix = excluded.r2_prefix,
           store = excluded.store,
           hosted_on = excluded.hosted_on,
           updated_at = excluded.updated_at`,
    )
      .bind(slug, STORE_CONFIG.domain, r2Prefix, STORE_CONFIG.registryKey, now)
      .run();
    return {
      name: 'Hosting route',
      status: 'ok',
      detail: `${slug}.${STORE_CONFIG.domain} → r2://${STORE_CONFIG.r2Bucket}/${r2Prefix}`,
    };
  } catch (e: any) {
    return { name: 'Hosting route', status: 'fail', detail: e?.message ?? 'D1 insert failed' };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Flip the build status of one or more registry entries (#22), in ONE commit.
 *
 *  Batched deliberately: the hourly reconcile can resolve several pending games
 *  at once, and N separate read-modify-writes would both burn N commits and
 *  contend with each other on the same file.
 *
 *  Transition rules (see GameStatus):
 *    - → `live`   always applies.
 *    - → `failed` applies ONLY to a game that has never succeeded. A `live` game
 *      whose latest build failed is still serving its last good artifact from R2;
 *      delisting it would take a working game off the store.
 *    - Nothing here ever writes `pending` — only provisioning does.
 *
 *  Unknown ids and no-op transitions are skipped, not failed. Retry-once-on-409
 *  mirrors the provision path's registry write (vendored, not shared). */
export async function setGameStatuses(
  env: PublishEnv,
  updates: Array<{ id: string; status: 'live' | 'failed' }>,
  org = STORE_CONFIG.org,
  storeRepo = STORE_CONFIG.storeRepo,
  key = STORE_CONFIG.registryKey,
): Promise<{ ok: boolean; updated: string[]; skipped: string[]; detail: string }> {
  if (updates.length === 0) return { ok: true, updated: [], skipped: [], detail: 'no updates' };
  const registryPath = `/repos/${org}/${storeRepo}/contents/${STORE_CONFIG.storeRegistryPath}`;

  const attempt = async (): Promise<{
    ok: boolean;
    updated: string[];
    skipped: string[];
    detail: string;
  } | null> => {
    const registryFile = await ghApi(env, registryPath);
    if (!registryFile.content) {
      return { ok: false, updated: [], skipped: [], detail: 'Could not read registry.json' };
    }
    const content = JSON.parse(decodeGhContent(registryFile.content));
    const items: any[] = content[key] || [];

    const updated: string[] = [];
    const skipped: string[] = [];
    for (const { id, status } of updates) {
      const entry = items.find((a) => a?.id === id);
      if (!entry) {
        skipped.push(`${id} (not listed)`);
        continue;
      }
      const current = readGameStatus(entry);
      if (current === status) {
        skipped.push(`${id} (already ${status})`);
        continue;
      }
      if (status === 'failed' && current === 'live') {
        // Shipped once, broken now — R2 still serves the last good build.
        skipped.push(`${id} (live; failed build does not delist)`);
        continue;
      }
      entry.status = status;
      updated.push(id);
    }

    if (updated.length === 0) {
      return { ok: true, updated, skipped, detail: skipped.join(', ') || 'no change' };
    }

    content[key] = items;
    const message =
      updated.length === 1
        ? `Mark ${updated[0]} ${updates.find((u) => u.id === updated[0])!.status}`
        : `Update build status for ${updated.length} games`;
    const res = await ghApi(env, registryPath, 'PUT', {
      message,
      content: btoa(
        Array.from(new TextEncoder().encode(JSON.stringify(content, null, 2)))
          .map((b) => String.fromCharCode(b))
          .join(''),
      ),
      sha: registryFile.sha,
    });
    if (res.content) {
      return { ok: true, updated, skipped, detail: `${updated.join(', ')} updated` };
    }
    if (res.__status === 409) return null; // contended — caller retries once
    return { ok: false, updated: [], skipped, detail: res.message || 'Failed to update registry' };
  };

  return (
    (await attempt()) ??
    (await attempt()) ?? {
      ok: false,
      updated: [],
      skipped: [],
      detail: 'Registry write contended twice',
    }
  );
}

/** Single-entry convenience wrapper over setGameStatuses, shaped as a Step. */
export async function setGameStatus(
  env: PublishEnv,
  id: string,
  status: 'live' | 'failed',
): Promise<Step> {
  const r = await setGameStatuses(env, [{ id, status }]);
  if (!r.ok) return { name: 'Build status', status: 'fail', detail: r.detail };
  return {
    name: 'Build status',
    status: r.updated.length > 0 ? 'ok' : 'skip',
    detail: r.updated.length > 0 ? `${id} → ${status}` : r.detail,
  };
}

/** After a template `/generate`, GitHub copies files verbatim — so `APPNAME`
 *  placeholders survive. Rewrite them in ONE commit (slug for package names +
 *  analytics, display name for titles/manifest) so the FIRST Actions deploy
 *  builds a correctly-named game. deploy.yml uses concurrency cancel-in-progress,
 *  so if the generate commit already kicked a run, this commit's run supersedes
 *  it. Non-fatal: a game that keeps "APPNAME" still works, just mis-titled. */
async function substituteTemplatePlaceholders(
  env: PublishEnv,
  org: string,
  id: string,
  name: string,
): Promise<Step> {
  const repo = `${org}/${id}`;
  const targets: Array<{ path: string; rewrite: (s: string) => string }> = [
    { path: 'package.json', rewrite: (s) => s.replace(/APPNAME/g, id) },
    { path: 'web/package.json', rewrite: (s) => s.replace(/APPNAME/g, id) },
    // index.html carries BOTH the analytics slug (?app=APPNAME) and the <title>.
    // `name` is a function replacer so `$&`/`$1`/`$'` in a display name aren't
    // interpreted as replacement patterns (which would corrupt the file).
    {
      path: 'web/index.html',
      rewrite: (s) => s.replace(/app=APPNAME/g, `app=${id}`).replace(/APPNAME/g, () => name),
    },
    { path: 'web/src/App.tsx', rewrite: (s) => s.replace(/APPNAME/g, () => name) },
    // pixi/babylon templates render the title from a local Shell component.
    { path: 'web/src/components/Shell.tsx', rewrite: (s) => s.replace(/APPNAME/g, () => name) },
    { path: 'web/vite.config.ts', rewrite: (s) => s.replace(/APPNAME/g, () => name) },
    { path: 'CLAUDE.md', rewrite: (s) => s.replace(/APPNAME/g, () => name) },
  ];
  try {
    // Generate is async — poll for the repo's main ref before committing.
    let headSha = '';
    for (let i = 0; i < 12; i++) {
      const ref = await ghApi(env, `/repos/${repo}/git/ref/heads/main`);
      if (ref.object?.sha) {
        headSha = ref.object.sha;
        break;
      }
      await sleep(1500);
    }
    if (!headSha)
      return { name: 'Naming', status: 'fail', detail: 'repo not ready for substitution' };
    const headCommit = await ghApi(env, `/repos/${repo}/git/commits/${headSha}`);
    const baseTree = headCommit.tree?.sha;
    if (!baseTree) return { name: 'Naming', status: 'fail', detail: 'could not read base tree' };

    const treeItems: Array<{ path: string; mode: string; type: string; sha: string }> = [];
    for (const t of targets) {
      const file = await ghApi(env, `/repos/${repo}/contents/${t.path}`);
      if (!file.content) continue; // not in this template variant
      const original = new TextDecoder().decode(
        Uint8Array.from(atob(file.content.replace(/\n/g, '')), (c) => c.charCodeAt(0)),
      );
      if (!original.includes('APPNAME')) continue;
      const blob = await ghApi(env, `/repos/${repo}/git/blobs`, 'POST', {
        content: t.rewrite(original),
        encoding: 'utf-8',
      });
      if (blob.sha) treeItems.push({ path: t.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    if (treeItems.length === 0)
      return { name: 'Naming', status: 'skip', detail: 'no placeholders found' };

    const tree = await ghApi(env, `/repos/${repo}/git/trees`, 'POST', {
      base_tree: baseTree,
      tree: treeItems,
    });
    if (!tree.sha) return { name: 'Naming', status: 'fail', detail: 'tree create failed' };
    const commit = await ghApi(env, `/repos/${repo}/git/commits`, 'POST', {
      message: `Set game name to "${name}"`,
      tree: tree.sha,
      parents: [headSha],
    });
    if (!commit.sha) return { name: 'Naming', status: 'fail', detail: 'commit failed' };
    const upd = await ghApi(env, `/repos/${repo}/git/refs/heads/main`, 'PATCH', {
      sha: commit.sha,
    });
    return upd.ref
      ? { name: 'Naming', status: 'ok', detail: `substituted APPNAME in ${treeItems.length} files` }
      : { name: 'Naming', status: 'fail', detail: 'ref update failed' };
  } catch (e: any) {
    return { name: 'Naming', status: 'fail', detail: e?.message ?? 'substitution error' };
  }
}

/** Decode a GitHub contents/blob base64 payload to a UTF-8 string. */
function decodeGhContent(b64: string): string {
  return new TextDecoder().decode(
    Uint8Array.from(atob(b64.replace(/\n/g, '')), (c) => c.charCodeAt(0)),
  );
}

/** Whether `login` already has access to (or a pending invite on) a repo. The
 *  provision that GENERATES a repo invites its creator straight away, so this is
 *  what separates a creator retrying their own cut-off provision from a racer
 *  who lost the generate (#88). Throws on an inconclusive GitHub answer. */
async function hasRepoAccessOrInvite(
  env: PublishEnv,
  org: string,
  id: string,
  login: string,
): Promise<boolean> {
  const collab = await ghApi(env, `/repos/${org}/${id}/collaborators/${login}`);
  if (collab.__status === 204) return true;
  if (collab.__status !== 404) throw new Error(`collaborator check returned ${collab.__status}`);
  const invites = await ghApi(env, `/repos/${org}/${id}/invitations?per_page=100`);
  if (invites.__status !== 200 || !Array.isArray(invites)) {
    throw new Error(`invitation check returned ${invites.__status}`);
  }
  return invites.some(
    (inv: { invitee?: { login?: unknown } }) =>
      typeof inv?.invitee?.login === 'string' &&
      inv.invitee.login.toLowerCase() === login.toLowerCase(),
  );
}

/** Why an already-existing repo must not be (re-)provisioned for `owner`, or
 *  null. `conflict` marks "this id belongs to someone else" so callers (the
 *  agent's deploy) can refuse to bind to it.
 *   - Listed with a recorded creator: only that creator may re-provision.
 *     Listed legacy entries (no creator) keep their heal/skip behaviour.
 *   - Unlisted: must be generated from one of our `template-game-*` repos, not
 *     archived (#61), AND `owner` must already have access or an invite — i.e.
 *     it is their own provision that was cut off before its registry write,
 *     not a concurrent provision that won the generate (#88).
 *  Fails closed when the registry or GitHub cannot give a clear answer. */
async function existingRepoClaimError(
  env: PublishEnv,
  config: typeof STORE_CONFIG,
  id: string,
  repo: {
    archived?: unknown;
    template_repository?: { name?: unknown; owner?: { login?: unknown } } | null;
  },
  owner: string | undefined,
): Promise<{ error: string; conflict: boolean } | null> {
  const registryFile = await ghApi(
    env,
    `/repos/${config.org}/${config.storeRepo}/contents/${STORE_CONFIG.storeRegistryPath}`,
  );
  let items: unknown = null;
  try {
    if (registryFile.content)
      items = JSON.parse(decodeGhContent(registryFile.content))[config.registryKey];
  } catch {
    items = null;
  }
  if (!Array.isArray(items)) {
    return {
      error: `Could not read registry.json to verify ${config.org}/${id} — aborting to avoid claiming an existing repo. Please retry.`,
      conflict: false,
    };
  }
  const listed = items.find((g) => (g as { id?: unknown })?.id === id) as
    | { creatorGithub?: unknown }
    | undefined;
  if (listed) {
    if (typeof listed.creatorGithub !== 'string' || !listed.creatorGithub) return null;
    if (owner && listed.creatorGithub.toLowerCase() === owner.toLowerCase()) return null;
    return {
      error: `"${id}" is already taken by another creator — choose a different id`,
      conflict: true,
    };
  }

  const template = repo.template_repository;
  const fromGameTemplate =
    template?.owner?.login === config.org &&
    typeof template?.name === 'string' &&
    template.name.startsWith('template-game-');
  if (!fromGameTemplate || repo.archived === true) {
    return {
      error: `${config.org}/${id} already exists and is not a game this service provisioned — choose a different id`,
      conflict: true,
    };
  }
  if (!owner) {
    return { error: `"${id}" is already taken — choose a different id`, conflict: true };
  }
  try {
    if (await hasRepoAccessOrInvite(env, config.org, id, owner)) return null;
  } catch (e) {
    return {
      error: `Could not verify ownership of ${config.org}/${id} (${e instanceof Error ? e.message : String(e)}) — aborting. Please retry.`,
      conflict: false,
    };
  }
  return {
    error: `"${id}" is already taken by another creator — choose a different id`,
    conflict: true,
  };
}

const REMIX_CREDIT_MARKER = 'fgs-remix-attribution';

/**
 * The game templates live in their own repositories, so a Remix needs a
 * self-contained credit surface at provision time. This markup works for every
 * supported engine/template (including templates with a local shell instead of
 * the SDK). It deliberately uses textContent for all snapshot data and only
 * enables the source-game link after the public registry confirms the id still
 * exists. A deleted source therefore keeps its immutable credit without a dead
 * link.
 */
export function renderRemixAttributionShell(attribution: ForkAttribution): string {
  if (!isForkAttribution(attribution)) return '';
  // JSON is data, never executable source. Escape '<' so a hostile display name
  // cannot terminate the application/json script element.
  const data = JSON.stringify(attribution).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  return `
    <script id="${REMIX_CREDIT_MARKER}" type="application/json">${data}</script>
    <script>
      (() => {
        const dataNode = document.getElementById('${REMIX_CREDIT_MARKER}');
        if (!dataNode) return;
        let attribution;
        try { attribution = JSON.parse(dataNode.textContent || ''); } catch { return; }
        const validId = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
        const validLogin = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
        if (!attribution || !validId.test(attribution.id) ||
            typeof attribution.name !== 'string' || !attribution.name.trim() ||
            !validLogin.test(attribution.creatorGithub)) return;

        const credit = document.createElement('aside');
        credit.id = 'fgs-remix-credit';
        credit.setAttribute('aria-label', 'Remix attribution');
        Object.assign(credit.style, {
          position: 'fixed', right: '0.45rem', bottom: '0.35rem', zIndex: '2147483647',
          maxWidth: 'calc(100vw - 0.9rem)', padding: '0.18rem 0.35rem', borderRadius: '0.3rem',
          background: 'color-mix(in srgb, var(--panel, #fff) 92%, transparent)',
          color: 'var(--muted, #666)', font: '600 0.6rem/1.25 system-ui, sans-serif',
          textAlign: 'right', pointerEvents: 'none'
        });
        credit.append('Remixed from ');
        const sourceName = document.createElement('span');
        sourceName.textContent = attribution.name.trim();
        credit.append(sourceName, ' by ');
        const creator = document.createElement('a');
        creator.textContent = '@' + attribution.creatorGithub;
        creator.href = 'https://github.com/' + attribution.creatorGithub;
        creator.target = '_blank';
        creator.rel = 'noopener noreferrer';
        Object.assign(creator.style, { color: 'inherit', pointerEvents: 'auto' });
        credit.append(creator);
        document.body.append(credit);

        // The snapshot supplies the durable label; registry lookup is used only
        // to decide whether a source link is still live. Network failure safely
        // leaves the readable non-link fallback in place.
        fetch('https://raw.githubusercontent.com/freegamestore-online/platform/main/sites/freegamestore/registry.json')
          .then((response) => response.ok ? response.json() : null)
          .then((registry) => {
            if (!Array.isArray(registry && registry.games) ||
                !registry.games.some((game) => game && game.id === attribution.id)) return;
            const source = document.createElement('a');
            source.textContent = attribution.name.trim();
            source.href = 'https://' + attribution.id + '.freegamestore.online';
            source.target = '_blank';
            source.rel = 'noopener noreferrer';
            Object.assign(source.style, { color: 'inherit', pointerEvents: 'auto' });
            sourceName.replaceWith(source);
          })
          .catch(() => {});
      })();
    </script>`;
}

/** Add the cross-template, runtime-safe Remix credit to a generated game. */
async function addRemixAttributionShell(
  env: PublishEnv,
  org: string,
  id: string,
  attribution: ForkAttribution,
): Promise<Step> {
  const markup = renderRemixAttributionShell(attribution);
  if (!markup)
    return { name: 'Remix attribution', status: 'fail', detail: 'invalid source snapshot' };
  const path = `/repos/${org}/${id}/contents/web/index.html`;
  try {
    const file = await ghApi(env, path);
    if (!file.content || !file.sha) {
      return { name: 'Remix attribution', status: 'fail', detail: 'could not read game shell' };
    }
    const original = decodeGhContent(file.content);
    if (original.includes(`id="${REMIX_CREDIT_MARKER}"`)) {
      return { name: 'Remix attribution', status: 'skip', detail: 'already present' };
    }
    const updated = original.includes('</body>')
      ? original.replace('</body>', `${markup}\n  </body>`)
      : `${original}\n${markup}`;
    const result = await ghApi(env, path, 'PUT', {
      message: 'Add immutable Remix attribution',
      content: btoa(
        Array.from(new TextEncoder().encode(updated))
          .map((byte) => String.fromCharCode(byte))
          .join(''),
      ),
      sha: file.sha,
    });
    return result.__status >= 200 && result.__status < 300
      ? { name: 'Remix attribution', status: 'ok', detail: 'added immutable source credit' }
      : {
          name: 'Remix attribution',
          status: 'fail',
          detail: result.message || 'shell update failed',
        };
  } catch (error: any) {
    return {
      name: 'Remix attribution',
      status: 'fail',
      detail: error?.message || 'shell update error',
    };
  }
}

/** Resolve the engine a source game was built on, from its web/package.json
 *  dependencies (same rule as the agent's detectEngine). Returns a TEMPLATE_REPOS
 *  key, or "" if the source is missing/unreadable. Grid/cards can't be told apart
 *  from canvas by deps alone, so a no-engine source resolves to "canvas" (its
 *  web/src overlays cleanly on the canvas template). */
async function resolveSourceEngine(
  env: PublishEnv,
  org: string,
  sourceId: string,
): Promise<string> {
  const f = await ghApi(env, `/repos/${org}/${sourceId}/contents/web/package.json`);
  if (!f.content) return '';
  try {
    const pkg = JSON.parse(decodeGhContent(f.content)) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps['phaser']) return 'phaser';
    if (deps['kaplay']) return 'kaplay';
    if (deps['@react-three/fiber']) return '3d';
    if (deps['pixi.js']) return 'pixi';
    if (deps['@babylonjs/core']) return 'babylon';
    if (deps['excalibur']) return 'excalibur';
    if (deps['littlejsengine']) return 'littlejs';
    if (deps['three']) return '3d';
    return 'canvas';
  } catch {
    return '';
  }
}

/** Remix overlay: copy a source game's web/src (+ web/public) files onto a
 *  freshly-generated repo, so the new game starts from the source's real code on
 *  top of correctly-named infra. Non-fatal — a failure leaves the plain template.
 *  Bounded to keep the GitHub API call count within the Worker subrequest budget. */
async function overlayGameSource(
  env: PublishEnv,
  org: string,
  newId: string,
  sourceId: string,
): Promise<Step> {
  const MAX_FILES = 40;
  try {
    const srcRef = await ghApi(env, `/repos/${org}/${sourceId}/git/ref/heads/main`);
    const srcSha = srcRef.object?.sha;
    if (!srcSha) return { name: 'Remix', status: 'fail', detail: `source ${sourceId} not ready` };
    const srcCommit = await ghApi(env, `/repos/${org}/${sourceId}/git/commits/${srcSha}`);
    const srcTreeSha = srcCommit.tree?.sha;
    if (!srcTreeSha) return { name: 'Remix', status: 'fail', detail: 'could not read source tree' };
    const srcTree = await ghApi(
      env,
      `/repos/${org}/${sourceId}/git/trees/${srcTreeSha}?recursive=1`,
    );
    const blobs: Array<{ path: string; sha: string }> = (srcTree.tree || []).filter(
      (t: any) =>
        t.type === 'blob' && (t.path.startsWith('web/src/') || t.path.startsWith('web/public/')),
    );
    if (blobs.length === 0)
      return { name: 'Remix', status: 'skip', detail: 'no source files to copy' };
    const picked = blobs.slice(0, MAX_FILES);

    const tgtRef = await ghApi(env, `/repos/${org}/${newId}/git/ref/heads/main`);
    const tgtSha = tgtRef.object?.sha;
    if (!tgtSha) return { name: 'Remix', status: 'fail', detail: 'target not ready' };
    const tgtCommit = await ghApi(env, `/repos/${org}/${newId}/git/commits/${tgtSha}`);
    const baseTree = tgtCommit.tree?.sha;
    if (!baseTree) return { name: 'Remix', status: 'fail', detail: 'could not read target tree' };

    const treeItems: Array<{ path: string; mode: string; type: string; sha: string }> = [];
    for (const b of picked) {
      const blob = await ghApi(env, `/repos/${org}/${sourceId}/git/blobs/${b.sha}`);
      if (!blob.content) continue;
      const created = await ghApi(env, `/repos/${org}/${newId}/git/blobs`, 'POST', {
        content: blob.content,
        encoding: blob.encoding || 'base64',
      });
      if (created.sha)
        treeItems.push({ path: b.path, mode: '100644', type: 'blob', sha: created.sha });
    }
    if (treeItems.length === 0) return { name: 'Remix', status: 'fail', detail: 'no files copied' };

    const tree = await ghApi(env, `/repos/${org}/${newId}/git/trees`, 'POST', {
      base_tree: baseTree,
      tree: treeItems,
    });
    if (!tree.sha) return { name: 'Remix', status: 'fail', detail: 'tree create failed' };
    const commit = await ghApi(env, `/repos/${org}/${newId}/git/commits`, 'POST', {
      message: `Remix source from ${sourceId}`,
      tree: tree.sha,
      parents: [tgtSha],
    });
    if (!commit.sha) return { name: 'Remix', status: 'fail', detail: 'commit failed' };
    const upd = await ghApi(env, `/repos/${org}/${newId}/git/refs/heads/main`, 'PATCH', {
      sha: commit.sha,
    });
    const more = blobs.length > picked.length ? ` (first ${picked.length} of ${blobs.length})` : '';
    return upd.ref
      ? {
          name: 'Remix',
          status: 'ok',
          detail: `copied ${treeItems.length} files from ${sourceId}${more}`,
        }
      : { name: 'Remix', status: 'fail', detail: 'ref update failed' };
  } catch (e: any) {
    return { name: 'Remix', status: 'fail', detail: e?.message ?? 'remix overlay error' };
  }
}

/** Read the source before creating the target repo. A remix must be able to
 * retain complete credit at creation time; accepting an incomplete source would
 * recreate the lineage loss that #44 fixes. */
async function getSourceForkAttribution(
  env: PublishEnv,
  sourceId: string,
  forkedAt: string,
): Promise<{ attribution?: ForkAttribution; error?: string }> {
  const result = await readRegistry(env.GITHUB_TOKEN);
  if (result.status !== 'available')
    return { error: 'Could not read source attribution from registry' };
  const attribution = snapshotForkAttribution(
    sourceId,
    result.games.find((item) => item.id === sourceId),
    forkedAt,
  );
  return attribution
    ? { attribution }
    : { error: `Source ${sourceId} has incomplete immutable attribution data` };
}

export async function handlePublish(
  req: PublishRequest,
  env: PublishEnv,
): Promise<{
  steps: Step[];
  success: boolean;
  appUrl?: string;
  repoUrl?: string;
  /** The id belongs to another creator — callers must not bind to it (#88). */
  conflict?: boolean;
}> {
  const steps: Step[] = [];

  if (!req.name) {
    return {
      steps: [{ name: 'Validation', status: 'fail', detail: 'name is required' }],
      success: false,
    };
  }
  // The CLI sends only `name`; derive a slug if `id` is omitted. Apply
  // sensible defaults for the fields the CLI doesn't collect.
  const id = req.id ?? slugify(req.name);
  // `||` not `??` throughout: the VibeCode/CLI caller sends "" (not null) for
  // fields the creator left blank, and an empty string in the registry makes the
  // storefront build DROP the whole game from the store + search
  // (PLATFORM-ISSUES A1 + REGISTRY-VALIDATION-RECOMMENDATIONS). `||` falls back on
  // "" too, so a blank field is never persisted.
  const icon = req.icon || '🎮';
  const iconBg = req.iconBg || '#ecfdf5';
  const category = normalizeCategory(req.category);
  const description = req.description || req.oneliner || req.name;
  const name = displayName(req.name, id);
  const idError = validateId(id);
  if (idError) {
    return { steps: [{ name: 'Validation', status: 'fail', detail: idError }], success: false };
  }
  // Abort BEFORE any repo/route/registry write if the owner is malformed — never
  // persist an un-matchable `creatorGithub` (it is the ownership key downstream).
  if (req.creatorGithub && !VALID_GH_LOGIN.test(req.creatorGithub)) {
    return {
      steps: [{ name: 'Validation', status: 'fail', detail: 'Invalid creatorGithub username' }],
      success: false,
    };
  }

  const config = STORE_CONFIG;
  const subdomain = `${id}.${config.domain}`;
  const nowIso = new Date().toISOString();

  // Remix: a new game seeded from an existing published game's code (all free
  // games are MIT). Inherit the SOURCE's engine so the generated infra
  // (workflows, deps, lockfile) matches the web/src we overlay after generate —
  // the picker's `template` is ignored when cloning.
  const cloneFrom = typeof req.cloneFrom === 'string' ? req.cloneFrom.trim().toLowerCase() : '';
  let sourceForkAttribution: ForkAttribution | undefined;
  if (cloneFrom) {
    // `cloneFrom` is interpolated into privileged GitHub paths (engine lookup +
    // source overlay), so it must pass the same grammar/reserved-id rules as `id`
    // — otherwise a caller could read infra repos or path-traverse the API.
    const cloneError = validateId(cloneFrom);
    if (cloneError) {
      return {
        steps: [{ name: 'Validation', status: 'fail', detail: `Invalid cloneFrom: ${cloneError}` }],
        success: false,
      };
    }
    const sourceFork = await getSourceForkAttribution(env, cloneFrom, nowIso);
    if (sourceFork.error) {
      return {
        steps: [{ name: 'Fork attribution', status: 'fail', detail: sourceFork.error }],
        success: false,
      };
    }
    sourceForkAttribution = sourceFork.attribution;
    const srcEngine = await resolveSourceEngine(env, config.org, cloneFrom);
    if (srcEngine) req.template = srcEngine;
  }
  const templateRepo = TEMPLATE_REPOS[req.template ?? ''] ?? STORE_CONFIG.templateRepo;

  // Step 1: Create GitHub repo from template.
  // Fail SAFE on the existence check: only a 200 means "exists" and only a 404
  // means "free". A 401 (token expiry), 403 (rate limit), or 5xx must NOT be
  // read as "absent" — that would skip the duplicate guard and generate over an
  // existing game's repo (or a concurrent provision). Abort with a clear error.
  const repoCheck = await ghApi(env, `/repos/${config.org}/${id}`);
  if (repoCheck.__status !== 200 && repoCheck.__status !== 404) {
    return {
      steps: [
        {
          name: 'GitHub repo',
          status: 'fail',
          detail: `Could not verify repo id (GitHub returned ${repoCheck.__status}) — aborting to avoid provisioning over an existing game. Please retry.`,
        },
      ],
      success: false,
    };
  }
  const repoExisted = repoCheck.__status === 200;
  if (repoExisted) {
    // An existing repo is only provisionable if it is already a listed game or
    // provably an interrupted provision of one. Otherwise any signed-in caller
    // could register an arbitrary org repo (e.g. `platform`) as their game and
    // then archive it through the owner-checked delete path (#61).
    const claim = await existingRepoClaimError(env, config, id, repoCheck, req.creatorGithub);
    if (claim) {
      steps.push({ name: 'GitHub repo', status: 'fail', detail: claim.error });
      return { steps, success: false, ...(claim.conflict ? { conflict: true } : {}) };
    }
    steps.push({
      name: 'GitHub repo',
      status: 'skip',
      detail: `${config.org}/${id} already exists`,
    });
    // Heal an interrupted or partial provision: if a prior provision left the
    // repo titled "APPNAME" (cut off before the naming commit, or provisioned
    // before a template file — like the analytics-wired index.html — started
    // carrying APPNAME), a plain re-provision used to skip substitution forever.
    // Re-run it when EITHER signal proves an unsubstituted leftover:
    //   • root package.json NAME is still literally "APPNAME" (fresh generate), OR
    //   • web/index.html still has the `app=APPNAME` analytics slug — an
    //     unambiguous template leftover (a real game has app=<its-id>). This
    //     catches games whose package.json got substituted but index.html didn't
    //     (monster-attack, 2026-07-12). Both signals are template-specific, so we
    //     never rewrite an established game whose own source contains "APPNAME".
    const rootPkg = await ghApi(env, `/repos/${config.org}/${id}/contents/package.json`);
    const pkgRaw = rootPkg.content
      ? new TextDecoder().decode(
          Uint8Array.from(atob(rootPkg.content.replace(/\n/g, '')), (c) => c.charCodeAt(0)),
        )
      : '';
    const indexHtml = await ghApi(env, `/repos/${config.org}/${id}/contents/web/index.html`);
    const htmlRaw = indexHtml.content
      ? new TextDecoder().decode(
          Uint8Array.from(atob(indexHtml.content.replace(/\n/g, '')), (c) => c.charCodeAt(0)),
        )
      : '';
    if (/"name"\s*:\s*"APPNAME"/.test(pkgRaw) || /app=APPNAME/.test(htmlRaw)) {
      steps.push(await substituteTemplatePlaceholders(env, config.org, id, name));
    }
  } else {
    const createRepo = await ghApi(env, `/repos/${config.org}/${templateRepo}/generate`, 'POST', {
      owner: config.org,
      name: id,
      private: false,
      description,
    });
    if (createRepo.id) {
      steps.push({
        name: 'GitHub repo',
        status: 'ok',
        detail: `Created ${config.org}/${id} from ${templateRepo}`,
      });
      // Rewrite APPNAME placeholders (only meaningful on a fresh generate).
      steps.push(await substituteTemplatePlaceholders(env, config.org, id, name));
      // Remix: overlay the source game's web/src onto the fresh, correctly-named
      // infra so the new game starts from the source's real code.
      if (cloneFrom) {
        steps.push(await overlayGameSource(env, config.org, id, cloneFrom));
        // The source overlay intentionally excludes index.html so template infra
        // remains id-correct. Put the immutable Remix credit there: it is shared
        // by every supported game template and survives source-file replacement.
        if (sourceForkAttribution) {
          const attributionStep = await addRemixAttributionShell(
            env,
            config.org,
            id,
            sourceForkAttribution,
          );
          steps.push(attributionStep);
          if (attributionStep.status === 'fail') return { steps, success: false };
        }
      }
    } else {
      // 422 "already exists": a concurrent provision generated this id between
      // our existence check and now — it is theirs, not ours (#88).
      const lostRace =
        createRepo.__status === 422 && /already exists/i.test(String(createRepo.message ?? ''));
      steps.push({
        name: 'GitHub repo',
        status: 'fail',
        detail: lostRace
          ? `"${id}" was just taken by another creator — choose a different id`
          : createRepo.message || 'Failed to create repo',
      });
      return { steps, success: false, ...(lostRace ? { conflict: true } : {}) };
    }
  }

  // Step 1b: Add creator as collaborator with push access.
  //
  // SECURITY: only ever grant push on a repo we just CREATED in this call. The
  // provision endpoint authenticates the caller but does not verify ownership of
  // a pre-existing game, so adding a collaborator to an already-existing repo
  // would let any caller grant themselves (or an arbitrary `creatorGithub`) push
  // access to someone else's live game and ship code to its domain. Collaborator
  // changes on existing repos must go through an ownership-checked path, not here.
  // `creatorGithub` grammar is already validated + aborted at the top of this
  // function, so it is safe to interpolate into the collaborator API path here.
  if (req.creatorGithub && repoExisted) {
    steps.push({
      name: 'Collaborator',
      status: 'skip',
      detail: `${config.org}/${id} already exists — collaborator access unchanged (granting push on an existing repo requires an ownership-checked request)`,
    });
  } else if (req.creatorGithub) {
    const collab = await ghApi(
      env,
      `/repos/${config.org}/${id}/collaborators/${req.creatorGithub}`,
      'PUT',
      { permission: 'push' },
    );
    if (collab.id || collab.invitee || collab.__status === 201) {
      // 201 = an outside collaborator was INVITED. They must accept the invite
      // (GitHub email/notification) before they can push — surface that.
      steps.push({
        name: 'Collaborator',
        status: 'ok',
        detail: `${req.creatorGithub} invited as push collaborator — accept the GitHub invite to https://github.com/${config.org}/${id}/invitations (check email/notifications) before pushing`,
      });
    } else if (collab.__status === 204 || collab.message?.includes('already')) {
      steps.push({
        name: 'Collaborator',
        status: 'skip',
        detail: `${req.creatorGithub} already has access`,
      });
    } else {
      steps.push({
        name: 'Collaborator',
        status: 'fail',
        detail: collab.message || 'Failed to add collaborator',
      });
    }
  }

  // Step 2: Add to store registry — with retry-once-on-409. Two concurrent
  // provisions both GET the same sha and both PUT; GitHub rejects the second
  // with 409. Retry once: re-GET (fresh sha), re-check alreadyListed (the other
  // writer may already have added our entry), re-PUT. Mirrors the FAS admin's
  // writeRegistryWithRetry (vendored, not shared).
  const registryPath = `/repos/${config.org}/${config.storeRepo}/contents/${STORE_CONFIG.storeRegistryPath}`;
  const key = config.registryKey;
  let registryConflict = false;
  // The repo's HEAD once provisioning's own commits (template generate, naming,
  // remix overlay/attribution) have landed. Every deploy.yml run up to here is
  // the UNBUILT template scaffold, so the status backstop must not treat its
  // success as the game going live (#67). Best-effort: absent → backstop falls
  // back to recognising provisioning commits by message.
  const headRef = await ghApi(env, `/repos/${config.org}/${id}/git/ref/heads/main`);
  const provisionedSha =
    typeof headRef?.object?.sha === 'string' ? (headRef.object.sha as string) : undefined;
  const attemptRegistry = async (isRetry: boolean): Promise<Step | null> => {
    const registryFile = await ghApi(env, registryPath);
    if (!registryFile.content) {
      return { name: 'Store registry', status: 'fail', detail: 'Could not read registry.json' };
    }
    const rawContent = new TextDecoder().decode(
      Uint8Array.from(atob(registryFile.content.replace(/\n/g, '')), (c) => c.charCodeAt(0)),
    );
    const content = JSON.parse(rawContent);
    const items: Array<Record<string, unknown>> = Array.isArray(content[key]) ? content[key] : [];
    const existing = items.find((a: any) => a.id === id);
    if (existing) {
      // A concurrent provision may have listed this id first. If it recorded a
      // different creator, this caller lost the race and must not proceed as
      // though the game were theirs (#88).
      const listedOwner = typeof existing.creatorGithub === 'string' ? existing.creatorGithub : '';
      if (listedOwner && listedOwner.toLowerCase() !== (req.creatorGithub ?? '').toLowerCase()) {
        registryConflict = true;
        return {
          name: 'Store registry',
          status: 'fail',
          detail: `"${id}" was just taken by another creator — choose a different id`,
        };
      }
      return {
        name: 'Store registry',
        status: 'skip',
        detail: isRetry ? 'Added by a concurrent provision' : 'Already listed',
      };
    }
    // Freeze safely-upgradable #35 strings while this write is already taking
    // place. Entries missing any historical fact stay strings rather than being
    // guessed into a misleading attribution object.
    migrateLegacyForkAttribution(items);
    items.push({
      id,
      name,
      category,
      icon,
      iconBg,
      description,
      appUrl: `https://${subdomain}`,
      repo: `${config.org}/${id}`,
      hostedOn: 'r2',
      type: req.type || 'standalone',
      developer: req.creatorGithub || config.developer,
      ...(req.creatorGithub ? { creatorGithub: req.creatorGithub } : {}),
      // Which engine/template this game was generated from (kaplay|phaser|3d|
      // canvas|grid|cards). Lets the storefront + studio show the engine and
      // lets the agent load engine-correct authoring context on import. Only
      // record a key that actually maps to a template repo — an unknown/typo'd
      // key falls back to canvas at generate time, so writing it here would
      // claim an engine the source doesn't match.
      ...(req.template && TEMPLATE_REPOS[req.template] ? { engine: req.template } : {}),
      // #44: source identity + display credit are captured before target side
      // effects. The PATCH allowlist below deliberately excludes this field.
      ...(sourceForkAttribution ? { forkedFrom: sourceForkAttribution } : {}),
      // Set once, on first add. `me.ts` reads this for the game's createdAt.
      firstPublished: nowIso,
      // Build lifecycle (#22). Provisioning deliberately runs BEFORE the first
      // build — repo, route and this entry all exist while the creator's code has
      // never compiled — so liveness cannot be inferred from "the host answers
      // 200" (it answers 200 for the template scaffold). `pending` until a
      // deploy.yml run concludes success; see setGameStatuses.
      status: 'pending' satisfies GameStatus,
      ...(provisionedSha ? { provisionedSha } : {}),
    });
    content[key] = items;

    const updateResult = await ghApi(env, registryPath, 'PUT', {
      message: `Add ${name} to games registry`,
      content: btoa(
        Array.from(new TextEncoder().encode(JSON.stringify(content, null, 2)))
          .map((b) => String.fromCharCode(b))
          .join(''),
      ),
      sha: registryFile.sha,
    });
    if (updateResult.content) {
      return { name: 'Store registry', status: 'ok', detail: `Added ${name}` };
    }
    if (updateResult.__status === 409) {
      return null; // contended — caller retries once
    }
    return {
      name: 'Store registry',
      status: 'fail',
      detail: updateResult.message || 'Failed to update',
    };
  };

  const firstReg = await attemptRegistry(false);
  const regStep =
    firstReg !== null
      ? firstReg
      : ((await attemptRegistry(true)) ?? {
          name: 'Store registry',
          status: 'fail',
          detail: 'Registry write contended twice — please retry the provision',
        });
  steps.push(regStep);

  // If the registry write failed the game isn't listed anywhere — do NOT then
  // create a host route for it, or we'd serve a game that's invisible on every
  // dashboard (served-but-invisible, the worst partial state). Bail now; the
  // repo + any route are absent, so an idempotent re-provision starts clean.
  if (regStep.status === 'fail') {
    return {
      steps,
      success: false,
      ...(registryConflict ? { conflict: true } : {}),
      appUrl: `https://${subdomain}`,
      repoUrl: `https://github.com/${config.org}/${id}`,
    };
  }

  // Step 3: Hosting route (Path B) — deliberately AFTER the registry write.
  // fgs/host serves from fgs-games R2 at games/<slug>/, which the per-repo
  // deploy.yml syncs on every push. Ordering repo → registry → route means the
  // worst partial failure is *listed-but-unserved* (a visible 404 that an
  // idempotent re-provision + reconcile() self-heal) rather than
  // served-but-invisible. A route failure is therefore NON-fatal to the entry
  // existing, but still counts as fail in `success` so the caller retries.
  const hostingStep = await insertHostRoute(env, id);
  steps.push(hostingStep);

  // The collaborator invite is informational — a transient GitHub failure there
  // must NOT fail the whole provision, or the caller sees success:false (→ HTTP
  // 400) even though the repo + host route + registry entry all succeeded,
  // leaving a listed-but-unserved game.
  // Collaborator/Naming/Remix failures are non-fatal: the repo + route + registry
  // still succeeded, so the game is live. A failed Remix just leaves the plain
  // template (the caller sees the "Remix: fail" step and can retry).
  const success = steps.every(
    (s) =>
      s.status !== 'fail' || s.name === 'Collaborator' || s.name === 'Naming' || s.name === 'Remix',
  );
  return {
    steps,
    success,
    appUrl: `https://${subdomain}`,
    repoUrl: `https://github.com/${config.org}/${id}`,
  };
}

/** Why a lifecycle operation failed, so the HTTP layer can answer with the
 *  right status instead of 400 for everything (#66). */
export type LifecycleErrorCode = 'invalid' | 'forbidden' | 'not_found' | 'conflict' | 'upstream';

/** HTTP status for a lifecycle error. Unknown/absent codes stay 400. */
export function lifecycleStatus(code?: LifecycleErrorCode): number {
  switch (code) {
    case 'forbidden':
      return 403;
    case 'not_found':
      return 404;
    case 'conflict':
      return 409;
    case 'upstream':
      return 502;
    default:
      return 400;
  }
}

/** HTTP status for a provision result: validation problems are the caller's
 *  (400), an id owned by someone else is a conflict (409), and everything else
 *  — GitHub, the registry, D1 — is an upstream failure the caller can retry
 *  (502), not a "bad request" (#66). */
export function provisionStatus(result: {
  success: boolean;
  conflict?: boolean;
  steps: Step[];
}): number {
  if (result.success) return 200;
  if (result.conflict) return 409;
  const failed = result.steps.find((st) => st.status === 'fail');
  return failed && (failed.name === 'Validation' || failed.name === 'Fork attribution') ? 400 : 502;
}

type RegistryMutation<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; code: LifecycleErrorCode };

/**
 * Read registry.json, apply `mutate` to its games array, and write it back with
 * the sha that was read. If another writer committed in between (GitHub 409 —
 * the hourly reconcile, a provision, another edit), re-read and re-apply ONCE,
 * so the mutation's checks (existence, ownership) run against the fresh state.
 * update/delete used to write once and surface the raw sha mismatch as a 400
 * (#66); provision and setGameStatuses already retried.
 */
async function mutateRegistry<T>(
  env: PublishEnv,
  message: string,
  mutate: (items: Array<Record<string, unknown>>) => RegistryMutation<T>,
): Promise<RegistryMutation<T>> {
  const config = STORE_CONFIG;
  const registryPath = `/repos/${config.org}/${config.storeRepo}/contents/${STORE_CONFIG.storeRegistryPath}`;
  for (let attempt = 0; ; attempt++) {
    const file = await ghApi(env, registryPath);
    if (!file.content) {
      return { ok: false, error: 'Could not read registry.json', code: 'upstream' };
    }
    let content: Record<string, unknown>;
    try {
      content = JSON.parse(decodeGhContent(file.content));
    } catch {
      return { ok: false, error: 'registry.json is not valid JSON', code: 'upstream' };
    }
    const items: Array<Record<string, unknown>> = Array.isArray(content[config.registryKey])
      ? (content[config.registryKey] as Array<Record<string, unknown>>)
      : [];
    const outcome = mutate(items);
    if (!outcome.ok) return outcome;
    content[config.registryKey] = items;
    const put = await ghApi(env, registryPath, 'PUT', {
      message,
      content: btoa(
        Array.from(new TextEncoder().encode(JSON.stringify(content, null, 2)))
          .map((b) => String.fromCharCode(b))
          .join(''),
      ),
      sha: file.sha,
    });
    if (put.content) return outcome;
    if (put.__status === 409 && attempt === 0) continue; // contended: re-read, re-apply
    return {
      ok: false,
      error: put.message || 'Failed to update registry',
      code: put.__status === 409 ? 'conflict' : 'upstream',
    };
  }
}

/** Update a game's metadata in registry.json. Only the game's creator can update. */
export async function handleUpdateGame(
  gameId: string,
  login: string,
  updates: Record<string, unknown>,
  env: PublishEnv,
): Promise<{ ok?: boolean; error?: string; code?: LifecycleErrorCode }> {
  // Allow updating these fields only, validated + normalized like provision.
  const checked = validateGameUpdates(updates, gameId);
  if ('error' in checked) return { error: checked.error, code: 'invalid' };

  const result = await mutateRegistry(
    env,
    `Update ${gameId} metadata (${Object.keys(checked.values).join(', ')})`,
    (items) => {
      const game = items.find((g) => g.id === gameId);
      if (!game) {
        return { ok: false, error: `Game "${gameId}" not found in registry`, code: 'not_found' };
      }
      // Only the creator can update. Default-deny: a game with no recorded
      // creatorGithub (legacy / dashboard-provisioned without the field) is NOT
      // editable via this self-service path — otherwise any authenticated user
      // could deface unowned listings. Such games must be fixed by backfilling
      // ownership (or an admin editing the registry directly).
      // Case-insensitive match, consistent with the view path (me.ts) — GitHub
      // logins are case-insensitive, so a casing difference must not make an
      // owned game uneditable.
      const owner = typeof game.creatorGithub === 'string' ? game.creatorGithub : '';
      if (
        !ownershipFacts(game, login, { isOrgMember: false, isLegacyAcceptedCollaborator: false })
          .isCreator
      ) {
        return {
          ok: false,
          error: owner
            ? `Only the creator (${owner}) can update this game`
            : `This game has no recorded owner and can't be edited here`,
          code: 'forbidden',
        };
      }
      let changed = false;
      for (const [key, value] of Object.entries(checked.values)) {
        if (value !== game[key]) {
          game[key] = value;
          changed = true;
        }
      }
      if (!changed) return { ok: false, error: 'No changes', code: 'invalid' };
      // Opportunistically freeze only legacy strings that can be reconstructed
      // from concrete registry facts. The edited game's own forkedFrom is never
      // an allowed input and therefore remains immutable.
      migrateLegacyForkAttribution(items);
      game.updatedAt = new Date().toISOString();
      return { ok: true, value: undefined };
    },
  );
  return result.ok ? { ok: true } : { error: result.error, code: result.code };
}

/**
 * Delete a game the caller owns: remove its registry entry, drop its D1 host
 * route, and ARCHIVE (not hard-delete) its GitHub repo — matching the workspace
 * "archive, never hard-delete" policy. Ownership is the same registry-primary,
 * default-deny check as handleUpdateGame.
 */
export async function handleDeleteGame(
  gameId: string,
  login: string,
  env: PublishEnv,
  /** ADMIN OVERRIDE — skips the creator-ownership check (#14, Deprovision).
   *  Only ever set from an admin-allowlisted console session. This is a
   *  destructive path: it delists the game, drops its route and archives the
   *  repo, for a game the caller does NOT own. Without it the console's
   *  Deprovision button could only ever delete the admin's own games, which is
   *  not what an ops console is for. */
  opts: { adminOverride?: boolean } = {},
): Promise<{ ok?: boolean; error?: string; code?: LifecycleErrorCode; steps?: Step[] }> {
  const config = STORE_CONFIG;

  const steps: Step[] = [];

  // 1. Remove the registry entry (delists it from the store + the dashboard).
  //    Existence and ownership are checked inside the mutation so a retry after
  //    a concurrent registry write re-checks them against the fresh state.
  const delisted = await mutateRegistry(env, `Delete ${gameId} from games registry`, (items) => {
    const idx = items.findIndex((g) => g.id === gameId);
    if (idx < 0) {
      return { ok: false, error: `Game "${gameId}" not found in registry`, code: 'not_found' };
    }
    const game = items[idx]!;
    const owner = typeof game.creatorGithub === 'string' ? game.creatorGithub : '';
    if (opts.adminOverride) {
      console.log(
        `[deprovision] ADMIN override by ${login} on ${gameId} (owner=${owner || 'none'})`,
      );
    }
    if (
      !opts.adminOverride &&
      !ownershipFacts(game, login, { isOrgMember: false, isLegacyAcceptedCollaborator: false })
        .isCreator
    ) {
      return {
        ok: false,
        error: owner
          ? `Only the creator (${owner}) can delete this game`
          : `This game has no recorded owner and can't be deleted here`,
        code: 'forbidden',
      };
    }
    items.splice(idx, 1);
    return { ok: true, value: undefined };
  });
  if (!delisted.ok) {
    if (delisted.code === 'upstream' || delisted.code === 'conflict') {
      steps.push({ name: 'Store registry', status: 'fail', detail: delisted.error });
      return { error: delisted.error, code: delisted.code, steps };
    }
    return { error: delisted.error, code: delisted.code };
  }
  steps.push({ name: 'Store registry', status: 'ok', detail: `${gameId} delisted` });

  // 2. Drop the D1 host route so <id>.<domain> stops resolving. Non-fatal: the
  //    registry delist already removes it everywhere user-facing.
  try {
    // The binding is required in production, but fail explicitly instead of
    // reporting a successful route removal when a misconfigured environment
    // has no D1 binding (optional chaining would otherwise make this a no-op).
    if (!env.DB) throw new Error('D1 binding not available');
    await env.DB.prepare('DELETE FROM routes WHERE slug = ? AND zone = ?')
      .bind(gameId, config.domain)
      .run();
    steps.push({
      name: 'Hosting route',
      status: 'ok',
      detail: `${gameId}.${config.domain} removed`,
    });
  } catch (e: any) {
    steps.push({
      name: 'Hosting route',
      status: 'fail',
      detail: e?.message ?? 'route delete failed',
    });
  }

  // 3. Archive (never hard-delete) the repo. Non-fatal.
  try {
    // ghApi deliberately returns GitHub error responses as data so provision
    // steps can present useful details. Do not mistake such a response for a
    // completed archive merely because fetch itself resolved.
    const archive = await ghApi(env, `/repos/${config.org}/${gameId}`, 'PATCH', {
      archived: true,
    });
    if (archive.__status < 200 || archive.__status >= 300) {
      throw new Error(archive.message || `GitHub returned ${archive.__status}`);
    }
    steps.push({ name: 'Repo', status: 'ok', detail: 'archived (never hard-deleted)' });
  } catch (e: any) {
    steps.push({ name: 'Repo', status: 'fail', detail: e?.message ?? 'archive failed' });
  }

  // 4. Purge the agent's session-index rows so the deleted game stops showing
  //    in "My Games" / the admin Sessions tab with a dead link. The agent owns
  //    that D1 (agent_sessions), so ask it over the service binding. Non-fatal.
  if (env.AGENT && env.INTERNAL_TOKEN) {
    try {
      const purge = await env.AGENT.fetch(
        `https://agent.${config.domain}/v1/admin/purge-game-sessions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Internal-Token': env.INTERNAL_TOKEN },
          body: JSON.stringify({ gameId }),
        },
      );
      if (!purge.ok) {
        throw new Error(`agent returned ${purge.status}`);
      }
      steps.push({ name: 'Session index', status: 'ok', detail: 'agent rows purged' });
    } catch (e: any) {
      steps.push({ name: 'Session index', status: 'fail', detail: e?.message ?? 'purge failed' });
    }
  } else {
    steps.push({ name: 'Session index', status: 'skip', detail: 'agent binding not configured' });
  }

  return { ok: true, steps };
}

export function renderProvisionForm(): string {
  return `
  <h2 style="margin-top:3rem;">Provision New Game (Path B)</h2>
  <p style="color:#888;margin-top:0.5rem;font-size:0.85rem;">Creates a GitHub repo from template-game-canvas, writes a D1 routes row, and adds the game to the storefront registry. No per-game CF Pages project — serves from R2 via the freegamestore-host Worker. Push to main triggers the GH Actions deploy that uploads to r2://fgs-games/games/&lt;slug&gt;/.</p>
  <form id="provisionForm" style="max-width:500px;margin-top:1rem;">
    <div style="display:grid;gap:0.75rem;">
      <input name="id" placeholder="ID (e.g. chess)" required style="padding:0.5rem;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:0.5rem;color:#e5e5e5;" />
      <input name="name" placeholder="Display name (e.g. Chess)" required style="padding:0.5rem;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:0.5rem;color:#e5e5e5;" />
      <input name="category" placeholder="Category (e.g. strategy)" required style="padding:0.5rem;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:0.5rem;color:#e5e5e5;" />
      <input name="icon" placeholder="Icon HTML entity (e.g. &#9812;)" required style="padding:0.5rem;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:0.5rem;color:#e5e5e5;" />
      <input name="iconBg" placeholder="Icon bg color (e.g. #f0fdf4)" value="#ecfdf5" style="padding:0.5rem;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:0.5rem;color:#e5e5e5;" />
      <input name="description" placeholder="Short description" required style="padding:0.5rem;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:0.5rem;color:#e5e5e5;" />
      <input name="creatorGithub" placeholder="Creator GitHub username (gets push access)" style="padding:0.5rem;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:0.5rem;color:#e5e5e5;" />
      <button type="submit" style="padding:0.6rem;background:#10b981;color:white;border:none;border-radius:0.5rem;cursor:pointer;font-weight:600;">Provision Game</button>
    </div>
  </form>
  <div id="provisionResult" style="margin-top:1rem;font-family:monospace;font-size:0.85rem;"></div>
  <script>
    document.getElementById('provisionForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = new FormData(e.target);
      const body = Object.fromEntries(form);
      const el = document.getElementById('provisionResult');
      el.innerHTML = '<span style="color:#fbbf24">Provisioning...</span>';
      try {
        const res = await fetch('/api/provision', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
        const data = await res.json();
        el.innerHTML = data.steps.map(s =>
          '<div style="margin:0.25rem 0">' +
          (s.status === 'ok' ? '<span style="color:#34d399">OK</span>' : s.status === 'skip' ? '<span style="color:#fbbf24">SKIP</span>' : '<span style="color:#f87171">FAIL</span>') +
          ' <strong>' + s.name + '</strong>: ' + s.detail + '</div>'
        ).join('') + '<div style="margin-top:0.75rem;font-weight:700;color:' + (data.success ? '#34d399' : '#f87171') + '">' +
          (data.success ? 'Provisioned successfully!' : 'Some steps failed.') + '</div>';
      } catch(err) {
        el.innerHTML = '<span style="color:#f87171">Error: ' + err + '</span>';
      }
    });
  </script>

  <h2 style="margin-top:3rem;">API Reference</h2>
  <div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:0.75rem;padding:1.5rem;margin-top:1rem;font-family:monospace;font-size:0.85rem;">
    <p style="margin-bottom:0.5rem;"><strong>POST /api/provision</strong></p>
    <p style="color:#888;margin-bottom:1rem;">Auth: HS256 Bearer (FAS-minted session token).</p>
    <pre style="color:#e5e5e5;white-space:pre-wrap;">{
  "id": "chess",
  "name": "Chess",
  "category": "strategy",
  "icon": "&amp;#9812;",
  "iconBg": "#ecfdf5",
  "description": "Classic chess game"
}</pre>
    <p style="margin-top:1rem;color:#888;">No CF Pages project is created — Path B serves from R2.</p>
  </div>`;
}
