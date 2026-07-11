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

interface PublishEnv {
  CF_ACCOUNT_ID: string;
  CF_API_TOKEN: string;
  GITHUB_TOKEN: string;
  DB: D1Database;
}

interface PublishRequest {
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
  /** Engine/starter key (kaplay|phaser|3d|pixi|babylon|canvas|grid|cards). Defaults to canvas. */
  template?: string;
  /** Remix: id of an existing published game to seed this one from (all free
   *  games are MIT). The new game inherits the source's engine and its web/src
   *  code is copied over the fresh template infra. */
  cloneFrom?: string;
}

// Starter templates the creator can pick from. Maps the short key the Dashboard
// sends to the actual template repo generated from. Unknown/absent → canvas.
const TEMPLATE_REPOS: Record<string, string> = {
  canvas: "template-game-canvas",
  grid: "template-game-grid",
  cards: "template-game-cards",
  // The three headline engines the Dashboard offers ("build on"):
  kaplay: "template-game-kaplay", // beginner-friendly 2D arcade engine
  phaser: "template-game-phaser", // production-grade 2D engine
  "3d": "template-game-3d", // Three.js + react-three-fiber (3D)
  pixi: "template-game-pixi", // Pixi.js v8 — WebGL 2D
  babylon: "template-game-babylon", // Babylon.js v7 — advanced 3D
};

/** Lowercase a display name into a valid slug (matches validateId rules). */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 58);
}

/** Canonical category: lowercase, spaces→hyphens (PLATFORM-ISSUES C). The
 *  storefront mixes `casual`/`Casual`/`Brain Training` otherwise, a trap for any
 *  case-sensitive filter. Empty → the default. */
function normalizeCategory(cat?: string): string {
  const c = (cat ?? "").trim().toLowerCase().replace(/\s+/g, "-");
  return c || "casual";
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
    .join(" ");
}

interface Step {
  name: string;
  status: "ok" | "skip" | "fail";
  detail: string;
}

const STORE_CONFIG = {
  org: "freegamestore-online",
  domain: "freegamestore.online",
  storeRepo: "freegamestore",
  registryKey: "games",
  developer: "FreeGameStore",
  templateRepo: "template-game-canvas",
  r2Bucket: "fgs-games",
};

async function ghApi(env: PublishEnv, path: string, method = "GET", body?: any) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "freegamestore-admin",
      "X-GitHub-Api-Version": "2022-11-28",
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
  "freegamestore", "submissions", "template-game-canvas", "template-game-3d",
  "template-game-grid", "template-game-cards", "template-game-kaplay",
  "template-game-phaser", "template-game-pixi", "template-game-babylon",
  "brand", "ops", "sdk",
]);

function validateId(id: string): string | null {
  if (!id) return "ID is required";
  if (id.length > 58) return "ID must be 58 characters or less";
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(id))
    return "ID must be lowercase letters, numbers, and dashes only. Cannot start/end with a dash.";
  if (id.startsWith("free") || id.startsWith("pro"))
    return "ID must not start with 'free' or 'pro'";
  // Reject any reserved infra id (exact match) plus every template-game-* variant
  // so a new template can't be squatted before its constant is added here.
  if (INFRA_REPOS.has(id) || id.startsWith("template-game-"))
    return "ID is reserved";
  return null;
}

// GitHub username grammar. `creatorGithub` is attacker-influenced (interpolated
// into a privileged github.com path + written to the registry as the ownership
// key), so an invalid value must abort the whole provision — never be persisted.
const VALID_GH_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

/** Write the D1 routes row that fgs/host reads to map host → R2 prefix.
 *  Idempotent via ON CONFLICT DO UPDATE — re-publishing the same id is a
 *  no-op for routing. r2_prefix follows the convention `games/<id>` which
 *  matches what the template's deploy.yml uploads to in fgs-games. */
export async function insertHostRoute(env: PublishEnv, slug: string): Promise<Step> {
  const r2Prefix = `${STORE_CONFIG.registryKey}/${slug}`;
  const now = Date.now();
  if (!env.DB) {
    return { name: "Hosting route", status: "fail", detail: "D1 binding not available" };
  }
  try {
    await env.DB
      .prepare(
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
      name: "Hosting route",
      status: "ok",
      detail: `${slug}.${STORE_CONFIG.domain} → r2://${STORE_CONFIG.r2Bucket}/${r2Prefix}`,
    };
  } catch (e: any) {
    return { name: "Hosting route", status: "fail", detail: e?.message ?? "D1 insert failed" };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    { path: "package.json", rewrite: (s) => s.replace(/APPNAME/g, id) },
    { path: "web/package.json", rewrite: (s) => s.replace(/APPNAME/g, id) },
    // index.html carries BOTH the analytics slug (?app=APPNAME) and the <title>.
    // `name` is a function replacer so `$&`/`$1`/`$'` in a display name aren't
    // interpreted as replacement patterns (which would corrupt the file).
    { path: "web/index.html", rewrite: (s) => s.replace(/app=APPNAME/g, `app=${id}`).replace(/APPNAME/g, () => name) },
    { path: "web/src/App.tsx", rewrite: (s) => s.replace(/APPNAME/g, () => name) },
    // pixi/babylon templates render the title from a local Shell component.
    { path: "web/src/components/Shell.tsx", rewrite: (s) => s.replace(/APPNAME/g, () => name) },
    { path: "web/vite.config.ts", rewrite: (s) => s.replace(/APPNAME/g, () => name) },
    { path: "CLAUDE.md", rewrite: (s) => s.replace(/APPNAME/g, () => name) },
  ];
  try {
    // Generate is async — poll for the repo's main ref before committing.
    let headSha = "";
    for (let i = 0; i < 12; i++) {
      const ref = await ghApi(env, `/repos/${repo}/git/ref/heads/main`);
      if (ref.object?.sha) { headSha = ref.object.sha; break; }
      await sleep(1500);
    }
    if (!headSha) return { name: "Naming", status: "fail", detail: "repo not ready for substitution" };
    const headCommit = await ghApi(env, `/repos/${repo}/git/commits/${headSha}`);
    const baseTree = headCommit.tree?.sha;
    if (!baseTree) return { name: "Naming", status: "fail", detail: "could not read base tree" };

    const treeItems: Array<{ path: string; mode: string; type: string; sha: string }> = [];
    for (const t of targets) {
      const file = await ghApi(env, `/repos/${repo}/contents/${t.path}`);
      if (!file.content) continue; // not in this template variant
      const original = new TextDecoder().decode(
        Uint8Array.from(atob(file.content.replace(/\n/g, "")), (c) => c.charCodeAt(0)),
      );
      if (!original.includes("APPNAME")) continue;
      const blob = await ghApi(env, `/repos/${repo}/git/blobs`, "POST", {
        content: t.rewrite(original),
        encoding: "utf-8",
      });
      if (blob.sha) treeItems.push({ path: t.path, mode: "100644", type: "blob", sha: blob.sha });
    }
    if (treeItems.length === 0) return { name: "Naming", status: "skip", detail: "no placeholders found" };

    const tree = await ghApi(env, `/repos/${repo}/git/trees`, "POST", { base_tree: baseTree, tree: treeItems });
    if (!tree.sha) return { name: "Naming", status: "fail", detail: "tree create failed" };
    const commit = await ghApi(env, `/repos/${repo}/git/commits`, "POST", {
      message: `Set game name to "${name}"`,
      tree: tree.sha,
      parents: [headSha],
    });
    if (!commit.sha) return { name: "Naming", status: "fail", detail: "commit failed" };
    const upd = await ghApi(env, `/repos/${repo}/git/refs/heads/main`, "PATCH", { sha: commit.sha });
    return upd.ref
      ? { name: "Naming", status: "ok", detail: `substituted APPNAME in ${treeItems.length} files` }
      : { name: "Naming", status: "fail", detail: "ref update failed" };
  } catch (e: any) {
    return { name: "Naming", status: "fail", detail: e?.message ?? "substitution error" };
  }
}

/** Decode a GitHub contents/blob base64 payload to a UTF-8 string. */
function decodeGhContent(b64: string): string {
  return new TextDecoder().decode(
    Uint8Array.from(atob(b64.replace(/\n/g, "")), (c) => c.charCodeAt(0)),
  );
}

/** Resolve the engine a source game was built on, from its web/package.json
 *  dependencies (same rule as the agent's detectEngine). Returns a TEMPLATE_REPOS
 *  key, or "" if the source is missing/unreadable. Grid/cards can't be told apart
 *  from canvas by deps alone, so a no-engine source resolves to "canvas" (its
 *  web/src overlays cleanly on the canvas template). */
async function resolveSourceEngine(env: PublishEnv, org: string, sourceId: string): Promise<string> {
  const f = await ghApi(env, `/repos/${org}/${sourceId}/contents/web/package.json`);
  if (!f.content) return "";
  try {
    const pkg = JSON.parse(decodeGhContent(f.content)) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps["phaser"]) return "phaser";
    if (deps["kaplay"]) return "kaplay";
    if (deps["@react-three/fiber"]) return "3d";
    if (deps["pixi.js"]) return "pixi";
    if (deps["@babylonjs/core"]) return "babylon";
    if (deps["three"]) return "3d";
    return "canvas";
  } catch {
    return "";
  }
}

/** Remix overlay: copy a source game's web/src (+ web/public) files onto a
 *  freshly-generated repo, so the new game starts from the source's real code on
 *  top of correctly-named infra. Non-fatal — a failure leaves the plain template.
 *  Bounded to keep the GitHub API call count within the Worker subrequest budget. */
async function overlayGameSource(env: PublishEnv, org: string, newId: string, sourceId: string): Promise<Step> {
  const MAX_FILES = 40;
  try {
    const srcRef = await ghApi(env, `/repos/${org}/${sourceId}/git/ref/heads/main`);
    const srcSha = srcRef.object?.sha;
    if (!srcSha) return { name: "Remix", status: "fail", detail: `source ${sourceId} not ready` };
    const srcCommit = await ghApi(env, `/repos/${org}/${sourceId}/git/commits/${srcSha}`);
    const srcTreeSha = srcCommit.tree?.sha;
    if (!srcTreeSha) return { name: "Remix", status: "fail", detail: "could not read source tree" };
    const srcTree = await ghApi(env, `/repos/${org}/${sourceId}/git/trees/${srcTreeSha}?recursive=1`);
    const blobs: Array<{ path: string; sha: string }> = (srcTree.tree || []).filter(
      (t: any) => t.type === "blob" && (t.path.startsWith("web/src/") || t.path.startsWith("web/public/")),
    );
    if (blobs.length === 0) return { name: "Remix", status: "skip", detail: "no source files to copy" };
    const picked = blobs.slice(0, MAX_FILES);

    const tgtRef = await ghApi(env, `/repos/${org}/${newId}/git/ref/heads/main`);
    const tgtSha = tgtRef.object?.sha;
    if (!tgtSha) return { name: "Remix", status: "fail", detail: "target not ready" };
    const tgtCommit = await ghApi(env, `/repos/${org}/${newId}/git/commits/${tgtSha}`);
    const baseTree = tgtCommit.tree?.sha;
    if (!baseTree) return { name: "Remix", status: "fail", detail: "could not read target tree" };

    const treeItems: Array<{ path: string; mode: string; type: string; sha: string }> = [];
    for (const b of picked) {
      const blob = await ghApi(env, `/repos/${org}/${sourceId}/git/blobs/${b.sha}`);
      if (!blob.content) continue;
      const created = await ghApi(env, `/repos/${org}/${newId}/git/blobs`, "POST", {
        content: blob.content,
        encoding: blob.encoding || "base64",
      });
      if (created.sha) treeItems.push({ path: b.path, mode: "100644", type: "blob", sha: created.sha });
    }
    if (treeItems.length === 0) return { name: "Remix", status: "fail", detail: "no files copied" };

    const tree = await ghApi(env, `/repos/${org}/${newId}/git/trees`, "POST", { base_tree: baseTree, tree: treeItems });
    if (!tree.sha) return { name: "Remix", status: "fail", detail: "tree create failed" };
    const commit = await ghApi(env, `/repos/${org}/${newId}/git/commits`, "POST", {
      message: `Remix source from ${sourceId}`,
      tree: tree.sha,
      parents: [tgtSha],
    });
    if (!commit.sha) return { name: "Remix", status: "fail", detail: "commit failed" };
    const upd = await ghApi(env, `/repos/${org}/${newId}/git/refs/heads/main`, "PATCH", { sha: commit.sha });
    const more = blobs.length > picked.length ? ` (first ${picked.length} of ${blobs.length})` : "";
    return upd.ref
      ? { name: "Remix", status: "ok", detail: `copied ${treeItems.length} files from ${sourceId}${more}` }
      : { name: "Remix", status: "fail", detail: "ref update failed" };
  } catch (e: any) {
    return { name: "Remix", status: "fail", detail: e?.message ?? "remix overlay error" };
  }
}

export async function handlePublish(
  req: PublishRequest,
  env: PublishEnv,
): Promise<{ steps: Step[]; success: boolean; appUrl?: string; repoUrl?: string }> {
  const steps: Step[] = [];

  if (!req.name) {
    return {
      steps: [{ name: "Validation", status: "fail", detail: "name is required" }],
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
  const icon = req.icon || "🎮";
  const iconBg = req.iconBg || "#ecfdf5";
  const category = normalizeCategory(req.category);
  const description = req.description || req.oneliner || req.name;
  const name = displayName(req.name, id);
  const idError = validateId(id);
  if (idError) {
    return { steps: [{ name: "Validation", status: "fail", detail: idError }], success: false };
  }
  // Abort BEFORE any repo/route/registry write if the owner is malformed — never
  // persist an un-matchable `creatorGithub` (it is the ownership key downstream).
  if (req.creatorGithub && !VALID_GH_LOGIN.test(req.creatorGithub)) {
    return { steps: [{ name: "Validation", status: "fail", detail: "Invalid creatorGithub username" }], success: false };
  }

  const config = STORE_CONFIG;
  const subdomain = `${id}.${config.domain}`;
  const nowIso = new Date().toISOString();

  // Remix: a new game seeded from an existing published game's code (all free
  // games are MIT). Inherit the SOURCE's engine so the generated infra
  // (workflows, deps, lockfile) matches the web/src we overlay after generate —
  // the picker's `template` is ignored when cloning.
  const cloneFrom = typeof req.cloneFrom === "string" ? req.cloneFrom.trim().toLowerCase() : "";
  if (cloneFrom) {
    const srcEngine = await resolveSourceEngine(env, config.org, cloneFrom);
    if (srcEngine) req.template = srcEngine;
  }
  const templateRepo = TEMPLATE_REPOS[req.template ?? ""] ?? STORE_CONFIG.templateRepo;

  // Step 1: Create GitHub repo from template.
  // Fail SAFE on the existence check: only a 200 means "exists" and only a 404
  // means "free". A 401 (token expiry), 403 (rate limit), or 5xx must NOT be
  // read as "absent" — that would skip the duplicate guard and generate over an
  // existing game's repo (or a concurrent provision). Abort with a clear error.
  const repoCheck = await ghApi(env, `/repos/${config.org}/${id}`);
  if (repoCheck.__status !== 200 && repoCheck.__status !== 404) {
    return {
      steps: [{
        name: "GitHub repo",
        status: "fail",
        detail: `Could not verify repo id (GitHub returned ${repoCheck.__status}) — aborting to avoid provisioning over an existing game. Please retry.`,
      }],
      success: false,
    };
  }
  const repoExisted = repoCheck.__status === 200;
  if (repoExisted) {
    steps.push({
      name: "GitHub repo",
      status: "skip",
      detail: `${config.org}/${id} already exists`,
    });
    // Heal an interrupted provision: if a prior provision generated the repo but
    // was cut off before the naming commit (e.g. the caller timed out after
    // /generate), the game is stuck titled "APPNAME" and a plain re-provision
    // used to skip substitution forever. Re-run it — but ONLY when root
    // package.json's NAME is still literally "APPNAME", which proves the repo is
    // an unsubstituted fresh generate. Matching the `"name": "APPNAME"` field
    // (not a bare "APPNAME" substring) guarantees we never rewrite an established
    // game whose own source happens to contain the word APPNAME.
    const rootPkg = await ghApi(env, `/repos/${config.org}/${id}/contents/package.json`);
    const pkgRaw = rootPkg.content
      ? new TextDecoder().decode(
          Uint8Array.from(atob(rootPkg.content.replace(/\n/g, "")), (c) => c.charCodeAt(0)),
        )
      : "";
    if (/"name"\s*:\s*"APPNAME"/.test(pkgRaw)) {
      steps.push(await substituteTemplatePlaceholders(env, config.org, id, name));
    }
  } else {
    const createRepo = await ghApi(
      env,
      `/repos/${config.org}/${templateRepo}/generate`,
      "POST",
      { owner: config.org, name: id, private: false, description },
    );
    if (createRepo.id) {
      steps.push({
        name: "GitHub repo",
        status: "ok",
        detail: `Created ${config.org}/${id} from ${templateRepo}`,
      });
      // Rewrite APPNAME placeholders (only meaningful on a fresh generate).
      steps.push(await substituteTemplatePlaceholders(env, config.org, id, name));
      // Remix: overlay the source game's web/src onto the fresh, correctly-named
      // infra so the new game starts from the source's real code.
      if (cloneFrom) {
        steps.push(await overlayGameSource(env, config.org, id, cloneFrom));
      }
    } else {
      steps.push({
        name: "GitHub repo",
        status: "fail",
        detail: createRepo.message || "Failed to create repo",
      });
      return { steps, success: false };
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
      name: "Collaborator",
      status: "skip",
      detail: `${config.org}/${id} already exists — collaborator access unchanged (granting push on an existing repo requires an ownership-checked request)`,
    });
  } else if (req.creatorGithub) {
    const collab = await ghApi(
      env,
      `/repos/${config.org}/${id}/collaborators/${req.creatorGithub}`,
      "PUT",
      { permission: "push" },
    );
    if (collab.id || collab.invitee || collab.__status === 201) {
      // 201 = an outside collaborator was INVITED. They must accept the invite
      // (GitHub email/notification) before they can push — surface that.
      steps.push({
        name: "Collaborator",
        status: "ok",
        detail: `${req.creatorGithub} invited as push collaborator — accept the GitHub invite to https://github.com/${config.org}/${id}/invitations (check email/notifications) before pushing`,
      });
    } else if (collab.__status === 204 || collab.message?.includes("already")) {
      steps.push({
        name: "Collaborator",
        status: "skip",
        detail: `${req.creatorGithub} already has access`,
      });
    } else {
      steps.push({
        name: "Collaborator",
        status: "fail",
        detail: collab.message || "Failed to add collaborator",
      });
    }
  }

  // Step 2: Add to store registry — with retry-once-on-409. Two concurrent
  // provisions both GET the same sha and both PUT; GitHub rejects the second
  // with 409. Retry once: re-GET (fresh sha), re-check alreadyListed (the other
  // writer may already have added our entry), re-PUT. Mirrors the FAS admin's
  // writeRegistryWithRetry (vendored, not shared).
  const registryPath = `/repos/${config.org}/${config.storeRepo}/contents/registry.json`;
  const key = config.registryKey;
  const attemptRegistry = async (
    isRetry: boolean,
  ): Promise<Step | null> => {
    const registryFile = await ghApi(env, registryPath);
    if (!registryFile.content) {
      return { name: "Store registry", status: "fail", detail: "Could not read registry.json" };
    }
    const rawContent = new TextDecoder().decode(
      Uint8Array.from(atob(registryFile.content.replace(/\n/g, "")), (c) => c.charCodeAt(0)),
    );
    const content = JSON.parse(rawContent);
    const items = content[key] || [];
    if (items.some((a: any) => a.id === id)) {
      return {
        name: "Store registry",
        status: "skip",
        detail: isRetry ? "Added by a concurrent provision" : "Already listed",
      };
    }
    items.push({
      id,
      name,
      category,
      icon,
      iconBg,
      description,
      appUrl: `https://${subdomain}`,
      repo: `${config.org}/${id}`,
      hostedOn: "r2",
      type: req.type || "standalone",
      developer: req.creatorGithub || config.developer,
      ...(req.creatorGithub ? { creatorGithub: req.creatorGithub } : {}),
      // Which engine/template this game was generated from (kaplay|phaser|3d|
      // canvas|grid|cards). Lets the storefront + studio show the engine and
      // lets the agent load engine-correct authoring context on import. Only
      // record a key that actually maps to a template repo — an unknown/typo'd
      // key falls back to canvas at generate time, so writing it here would
      // claim an engine the source doesn't match.
      ...(req.template && TEMPLATE_REPOS[req.template] ? { engine: req.template } : {}),
      // Set once, on first add. `me.ts` reads this for the game's createdAt.
      firstPublished: nowIso,
    });
    content[key] = items;

    const updateResult = await ghApi(env, registryPath, "PUT", {
      message: `Add ${name} to games registry`,
      content: btoa(
        Array.from(new TextEncoder().encode(JSON.stringify(content, null, 2)))
          .map((b) => String.fromCharCode(b))
          .join(""),
      ),
      sha: registryFile.sha,
    });
    if (updateResult.content) {
      return { name: "Store registry", status: "ok", detail: `Added ${name}` };
    }
    if (updateResult.__status === 409) {
      return null; // contended — caller retries once
    }
    return { name: "Store registry", status: "fail", detail: updateResult.message || "Failed to update" };
  };

  const firstReg = await attemptRegistry(false);
  const regStep =
    firstReg !== null
      ? firstReg
      : ((await attemptRegistry(true)) ?? {
          name: "Store registry",
          status: "fail",
          detail: "Registry write contended twice — please retry the provision",
        });
  steps.push(regStep);

  // If the registry write failed the game isn't listed anywhere — do NOT then
  // create a host route for it, or we'd serve a game that's invisible on every
  // dashboard (served-but-invisible, the worst partial state). Bail now; the
  // repo + any route are absent, so an idempotent re-provision starts clean.
  if (regStep.status === "fail") {
    return {
      steps,
      success: false,
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
    (s) => s.status !== "fail" || s.name === "Collaborator" || s.name === "Naming" || s.name === "Remix",
  );
  return {
    steps,
    success,
    appUrl: `https://${subdomain}`,
    repoUrl: `https://github.com/${config.org}/${id}`,
  };
}

/** Update a game's metadata in registry.json. Only the game's creator can update. */
export async function handleUpdateGame(
  gameId: string,
  login: string,
  updates: Record<string, unknown>,
  env: PublishEnv,
): Promise<{ ok?: boolean; error?: string }> {
  const config = STORE_CONFIG;
  const registryPath = `/repos/${config.org}/${config.storeRepo}/contents/registry.json`;
  const registryFile = await ghApi(env, registryPath);
  if (!registryFile.content) return { error: "Could not read registry.json" };

  const rawContent = new TextDecoder().decode(
    Uint8Array.from(atob(registryFile.content.replace(/\n/g, "")), (c) => c.charCodeAt(0)),
  );
  const content = JSON.parse(rawContent);
  const items: Array<Record<string, unknown>> = content[config.registryKey] || [];
  const idx = items.findIndex((g) => g.id === gameId);
  if (idx < 0) return { error: `Game "${gameId}" not found in registry` };

  const game = items[idx]!;
  // Only the creator can update. Default-deny: a game with no recorded
  // creatorGithub (legacy / dashboard-provisioned without the field) is NOT
  // editable via this self-service path — otherwise any authenticated user
  // could deface unowned listings. Such games must be fixed by backfilling
  // ownership (or an admin editing the registry directly).
  // Case-insensitive match, consistent with the view path (me.ts) — GitHub logins
  // are case-insensitive, so a casing difference must not make an owned game
  // uneditable.
  const owner = typeof game.creatorGithub === "string" ? game.creatorGithub : "";
  if (!owner || owner.toLowerCase() !== login.toLowerCase()) {
    return {
      error: owner
        ? `Only the creator (${owner}) can update this game`
        : `This game has no recorded owner and can't be edited here`,
    };
  }

  // Allow updating these fields only
  const allowed = ["name", "description", "category", "icon", "iconBg"];
  let changed = false;
  for (const key of allowed) {
    if (key in updates && typeof updates[key] === "string" && updates[key] !== game[key]) {
      game[key] = updates[key];
      changed = true;
    }
  }
  if (!changed) return { error: "No changes" };
  game.updatedAt = new Date().toISOString();

  items[idx] = game;
  content[config.registryKey] = items;

  const updateResult = await ghApi(env, registryPath, "PUT", {
    message: `Update ${gameId} metadata (${allowed.filter(k => k in updates).join(", ")})`,
    content: btoa(
      Array.from(new TextEncoder().encode(JSON.stringify(content, null, 2)))
        .map((b) => String.fromCharCode(b))
        .join(""),
    ),
    sha: registryFile.sha,
  });

  if (!updateResult.content) return { error: updateResult.message || "Failed to update registry" };
  return { ok: true };
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
): Promise<{ ok?: boolean; error?: string }> {
  const config = STORE_CONFIG;
  const registryPath = `/repos/${config.org}/${config.storeRepo}/contents/registry.json`;
  const registryFile = await ghApi(env, registryPath);
  if (!registryFile.content) return { error: "Could not read registry.json" };

  const rawContent = new TextDecoder().decode(
    Uint8Array.from(atob(registryFile.content.replace(/\n/g, "")), (c) => c.charCodeAt(0)),
  );
  const content = JSON.parse(rawContent);
  const items: Array<Record<string, unknown>> = content[config.registryKey] || [];
  const idx = items.findIndex((g) => g.id === gameId);
  if (idx < 0) return { error: `Game "${gameId}" not found in registry` };

  const game = items[idx]!;
  const owner = typeof game.creatorGithub === "string" ? game.creatorGithub : "";
  if (!owner || owner.toLowerCase() !== login.toLowerCase()) {
    return {
      error: owner
        ? `Only the creator (${owner}) can delete this game`
        : `This game has no recorded owner and can't be deleted here`,
    };
  }

  // 1. Remove the registry entry (delists it from the store + the dashboard).
  items.splice(idx, 1);
  content[config.registryKey] = items;
  const updateResult = await ghApi(env, registryPath, "PUT", {
    message: `Delete ${gameId} from games registry`,
    content: btoa(
      Array.from(new TextEncoder().encode(JSON.stringify(content, null, 2)))
        .map((b) => String.fromCharCode(b))
        .join(""),
    ),
    sha: registryFile.sha,
  });
  if (!updateResult.content) return { error: updateResult.message || "Failed to update registry" };

  // 2. Drop the D1 host route so <id>.<domain> stops resolving. Non-fatal: the
  //    registry delist already removes it everywhere user-facing.
  try {
    await env.DB?.prepare("DELETE FROM routes WHERE slug = ? AND zone = ?").bind(gameId, config.domain).run();
  } catch {
    /* route cleanup is best-effort */
  }

  // 3. Archive (never hard-delete) the repo. Non-fatal.
  try {
    await ghApi(env, `/repos/${config.org}/${gameId}`, "PATCH", { archived: true });
  } catch {
    /* archive is best-effort */
  }

  return { ok: true };
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
