// Publish API -- provisions a new game on FreeGameStore.
// POST /api/provision
// Body: { id, name, category, icon, iconBg, description, type?: "standalone"|"connected" }

interface PublishEnv {
  CF_ACCOUNT_ID: string;
  CF_API_TOKEN: string;
  CF_GLOBAL_KEY: string;
  CF_EMAIL: string;
  GITHUB_TOKEN: string;
}

interface PublishRequest {
  id: string;
  name: string;
  category: string;
  icon: string;
  iconBg: string;
  description: string;
  type?: string;
  creatorGithub?: string;
}

interface Step {
  name: string;
  status: "ok" | "skip" | "fail";
  detail: string;
}

const STORE_CONFIG = {
  org: "freegamestore-online",
  domain: "freegamestore.online",
  zoneId: "fd33f88109b97569f2c5d6f1e5bb62ae",
  storeRepo: "freegamestore",
  registryKey: "games",
  developer: "FreeGameStore",
  templateRepo: "template-game-canvas",
};

async function cfApi(env: PublishEnv, path: string, method = "GET", body?: any) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return (await res.json()) as any;
}

async function cfDnsApi(env: PublishEnv, zoneId: string, body: any) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`, {
    method: "POST",
    headers: { "X-Auth-Email": env.CF_EMAIL, "X-Auth-Key": env.CF_GLOBAL_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as any;
}

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
  return (await res.json()) as any;
}

function validateId(id: string): string | null {
  if (!id) return "ID is required";
  if (id.length > 58) return "ID must be 58 characters or less";
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(id)) return "ID must be lowercase letters, numbers, and dashes only. Cannot start/end with a dash.";
  if (id.startsWith("free") || id.startsWith("pro")) return "ID must not start with 'free' or 'pro'";
  return null;
}

export async function handlePublish(req: PublishRequest, env: PublishEnv): Promise<{ steps: Step[]; success: boolean }> {
  const steps: Step[] = [];

  // Validate inputs
  if (!req.id || !req.name) {
    return { steps: [{ name: "Validation", status: "fail", detail: "id and name are required" }], success: false };
  }
  const idError = validateId(req.id);
  if (idError) {
    return { steps: [{ name: "Validation", status: "fail", detail: idError }], success: false };
  }

  const config = STORE_CONFIG;
  const cfProject = `free${req.id}app`;
  const subdomain = `${req.id}.${config.domain}`;

  // Step 1: Create GitHub repo from template
  const repoCheck = await ghApi(env, `/repos/${config.org}/${req.id}`);
  if (repoCheck.id) {
    steps.push({ name: "GitHub repo", status: "skip", detail: `${config.org}/${req.id} already exists` });
  } else {
    const createRepo = await ghApi(env, `/repos/${config.org}/${config.templateRepo}/generate`, "POST", {
      owner: config.org,
      name: req.id,
      private: false,
      description: req.description,
    });
    if (createRepo.id) {
      steps.push({ name: "GitHub repo", status: "ok", detail: `Created ${config.org}/${req.id} from ${config.templateRepo}` });
    } else {
      steps.push({ name: "GitHub repo", status: "fail", detail: createRepo.message || "Failed to create repo" });
      return { steps, success: false };
    }
  }

  // Step 1b: Add creator as collaborator with push access
  if (req.creatorGithub) {
    const collab = await ghApi(
      env,
      `/repos/${config.org}/${req.id}/collaborators/${req.creatorGithub}`,
      "PUT",
      { permission: "push" },
    );
    if (collab.id || collab.invitee) {
      steps.push({ name: "Collaborator", status: "ok", detail: `${req.creatorGithub} granted push access` });
    } else if (collab.message?.includes("already")) {
      steps.push({ name: "Collaborator", status: "skip", detail: `${req.creatorGithub} already has access` });
    } else {
      steps.push({ name: "Collaborator", status: "fail", detail: collab.message || "Failed to add collaborator" });
    }
  }

  // Step 2: Create CF Pages project with GitHub source
  const projectCheck = await cfApi(env, `/accounts/${env.CF_ACCOUNT_ID}/pages/projects/${cfProject}`);
  if (projectCheck.success) {
    steps.push({ name: "CF Pages project", status: "skip", detail: `${cfProject} already exists` });
  } else {
    const createProject = await cfApi(env, `/accounts/${env.CF_ACCOUNT_ID}/pages/projects`, "POST", {
      name: cfProject,
      source: {
        type: "github",
        config: { owner: config.org, repo_name: req.id, production_branch: "main", deployments_enabled: true, production_deployments_enabled: true },
      },
      build_config: { build_command: "npx pnpm@10 install && npx pnpm@10 build", destination_dir: "web/dist" },
      deployment_configs: { production: { env_vars: { NODE_VERSION: { value: "22" } } } },
    });
    if (createProject.success) {
      steps.push({ name: "CF Pages project", status: "ok", detail: `Created ${cfProject} with GitHub source` });
    } else {
      steps.push({ name: "CF Pages project", status: "fail", detail: createProject.errors?.[0]?.message || "Failed" });
    }
  }

  // Step 3: Add custom domain to CF Pages
  const domainCheck = await cfApi(env, `/accounts/${env.CF_ACCOUNT_ID}/pages/projects/${cfProject}/domains`);
  const hasDomain = domainCheck.result?.some((d: any) => d.name === subdomain);
  if (hasDomain) {
    steps.push({ name: "Custom domain", status: "skip", detail: `${subdomain} already configured` });
  } else {
    const addDomain = await cfApi(env, `/accounts/${env.CF_ACCOUNT_ID}/pages/projects/${cfProject}/domains`, "POST", { name: subdomain });
    steps.push({
      name: "Custom domain",
      status: addDomain.success ? "ok" : "fail",
      detail: addDomain.success ? `Added ${subdomain}` : (addDomain.errors?.[0]?.message || "Failed"),
    });
  }

  // Step 4: Add DNS CNAME
  if (env.CF_GLOBAL_KEY) {
    const dnsResult = await cfDnsApi(env, config.zoneId, {
      type: "CNAME",
      name: req.id,
      content: `${cfProject}.pages.dev`,
      proxied: true,
    });
    steps.push({
      name: "DNS CNAME",
      status: dnsResult.success ? "ok" : "skip",
      detail: dnsResult.success ? `${req.id} -> ${cfProject}.pages.dev` : (dnsResult.errors?.[0]?.message || "May already exist"),
    });
  } else {
    steps.push({ name: "DNS CNAME", status: "skip", detail: "CF_GLOBAL_KEY not configured" });
  }

  // Step 5: Add to store registry
  const registryPath = `/repos/${config.org}/${config.storeRepo}/contents/registry.json`;
  const registryFile = await ghApi(env, registryPath);
  if (registryFile.content) {
    const rawContent = new TextDecoder().decode(Uint8Array.from(atob(registryFile.content.replace(/\n/g, "")), c => c.charCodeAt(0)));
    const content = JSON.parse(rawContent);
    const key = config.registryKey;
    const items = content[key] || [];
    const alreadyListed = items.some((a: any) => a.id === req.id);

    if (alreadyListed) {
      steps.push({ name: "Store registry", status: "skip", detail: "Already listed" });
    } else {
      items.push({
        id: req.id,
        name: req.name,
        category: req.category,
        icon: req.icon,
        iconBg: req.iconBg,
        description: req.description,
        appUrl: `https://${subdomain}`,
        repo: `${config.org}/${req.id}`,
        cfProject,
        type: req.type || "standalone",
        developer: config.developer,
      });
      content[key] = items;

      const updateResult = await ghApi(env, registryPath, "PUT", {
        message: `Add ${req.name} to games registry`,
        content: btoa(Array.from(new TextEncoder().encode(JSON.stringify(content, null, 2))).map(b => String.fromCharCode(b)).join("")),
        sha: registryFile.sha,
      });
      steps.push({
        name: "Store registry",
        status: updateResult.content ? "ok" : "fail",
        detail: updateResult.content ? `Added ${req.name}` : (updateResult.message || "Failed to update"),
      });
    }
  } else {
    steps.push({ name: "Store registry", status: "fail", detail: "Could not read registry.json" });
  }

  const success = steps.every((s) => s.status !== "fail");
  return { steps, success };
}

export function renderProvisionForm(): string {
  return `
  <h2 style="margin-top:3rem;">Provision New Game</h2>
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
    <p style="color:#888;margin-bottom:1rem;">Creates repo, CF Pages project, DNS, custom domain, and registry entry for a game.</p>
    <pre style="color:#e5e5e5;white-space:pre-wrap;">{
  "id": "chess",
  "name": "Chess",
  "category": "strategy",
  "icon": "&amp;#9812;",
  "iconBg": "#ecfdf5",
  "description": "Classic chess game"
}</pre>
    <p style="margin-top:1rem;color:#888;">Auth: Cloudflare Access (Google sign-in). No API tokens needed.</p>
    <p style="margin-top:0.5rem;color:#888;">For AI agents: <code>curl -X POST https://admin.freegamestore.online/api/provision -H 'Content-Type: application/json' -d '{...}'</code></p>
    <p style="margin-top:0.5rem;color:#f87171;">Note: API is behind Cloudflare Access. AI agents cannot call it directly -- use the admin UI or the publish.sh script locally.</p>
  </div>`;
}
