// Publish API -- provisions a new game on FreeGameStore via Path B.
// POST /api/provision
// Body: { id, name, category, icon, iconBg, description, type?, creatorGithub? }
//
// Path B (since 2026-05-28): instead of creating a CF Pages project, this
// writes a row to the shared `fas` D1 `routes` table. The fgs/host Worker
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
}

/** Lowercase a display name into a valid slug (matches validateId rules). */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 58);
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

function validateId(id: string): string | null {
  if (!id) return "ID is required";
  if (id.length > 58) return "ID must be 58 characters or less";
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(id))
    return "ID must be lowercase letters, numbers, and dashes only. Cannot start/end with a dash.";
  if (id.startsWith("free") || id.startsWith("pro"))
    return "ID must not start with 'free' or 'pro'";
  return null;
}

/** Write the D1 routes row that fgs/host reads to map host → R2 prefix.
 *  Idempotent via ON CONFLICT DO UPDATE — re-publishing the same id is a
 *  no-op for routing. r2_prefix follows the convention `games/<id>` which
 *  matches what the template's deploy.yml uploads to in fgs-games. */
async function insertHostRoute(env: PublishEnv, slug: string): Promise<Step> {
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
  const icon = req.icon ?? "🎮";
  const iconBg = req.iconBg ?? "#ecfdf5";
  const description = req.description ?? req.oneliner ?? req.name;
  const idError = validateId(id);
  if (idError) {
    return { steps: [{ name: "Validation", status: "fail", detail: idError }], success: false };
  }

  const config = STORE_CONFIG;
  const subdomain = `${id}.${config.domain}`;

  // Step 1: Create GitHub repo from template
  const repoCheck = await ghApi(env, `/repos/${config.org}/${id}`);
  if (repoCheck.id) {
    steps.push({
      name: "GitHub repo",
      status: "skip",
      detail: `${config.org}/${id} already exists`,
    });
  } else {
    const createRepo = await ghApi(
      env,
      `/repos/${config.org}/${config.templateRepo}/generate`,
      "POST",
      { owner: config.org, name: id, private: false, description },
    );
    if (createRepo.id) {
      steps.push({
        name: "GitHub repo",
        status: "ok",
        detail: `Created ${config.org}/${id} from ${config.templateRepo}`,
      });
    } else {
      steps.push({
        name: "GitHub repo",
        status: "fail",
        detail: createRepo.message || "Failed to create repo",
      });
      return { steps, success: false };
    }
  }

  // Step 1b: Add creator as collaborator with push access
  if (req.creatorGithub) {
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

  // Step 2: Hosting route (Path B). Replaces the previous CF Pages project
  // + custom domain + DNS CNAME steps. fgs/host serves from fgs-games R2
  // at games/<slug>/, which the per-repo deploy.yml syncs on every push.
  const hostingStep = await insertHostRoute(env, id);
  steps.push(hostingStep);
  if (hostingStep.status === "fail") {
    return { steps, success: false };
  }

  // Step 3: Add to store registry — with retry-once-on-409. Two concurrent
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
      name: req.name,
      category: req.category,
      icon,
      iconBg,
      description,
      appUrl: `https://${subdomain}`,
      repo: `${config.org}/${id}`,
      hostedOn: "r2",
      type: req.type || "standalone",
      developer: req.creatorGithub || config.developer,
      ...(req.creatorGithub ? { creatorGithub: req.creatorGithub } : {}),
    });
    content[key] = items;

    const updateResult = await ghApi(env, registryPath, "PUT", {
      message: `Add ${req.name} to games registry`,
      content: btoa(
        Array.from(new TextEncoder().encode(JSON.stringify(content, null, 2)))
          .map((b) => String.fromCharCode(b))
          .join(""),
      ),
      sha: registryFile.sha,
    });
    if (updateResult.content) {
      return { name: "Store registry", status: "ok", detail: `Added ${req.name}` };
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

  const success = steps.every((s) => s.status !== "fail");
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
  // Only the creator can update
  if (game.creatorGithub && game.creatorGithub !== login) {
    return { error: `Only the creator (${game.creatorGithub}) can update this game` };
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
