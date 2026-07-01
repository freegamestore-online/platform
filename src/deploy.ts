/** Deploy: provision via CF/GitHub APIs, then push all files. */

import type { StoreConfig } from "./config";

export interface DeployConfig {
  id: string;
  name: string;
  category: string;
  icon: string;
  iconBg: string;
  description: string;
}

export interface DeployEnv {
  GITHUB_TOKEN: string;
  CF_API_TOKEN: string;
  CF_ACCOUNT_ID: string;
  CF_GLOBAL_KEY: string;
  CF_EMAIL: string;
}

interface DeployStep {
  name: string;
  status: "ok" | "skip" | "fail";
  detail: string;
}

export type DeployStatus =
  | { phase: "provisioning"; steps: DeployStep[] }
  | { phase: "pushing"; progress: string }
  | { phase: "building"; deployUrl: string }
  | { phase: "live"; appUrl: string }
  | { phase: "error"; error: string };

async function cfApi(token: string, _accountId: string, path: string, method = "GET", body?: unknown) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json() as Promise<any>;
}

function makeGhApi(token: string, agentName: string) {
  return async (path: string, method = "GET", body?: unknown) => {
    const res = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": agentName,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json() as Promise<any>;
  };
}

/** Deploy = create repo + push code. No CF Pages, no DNS, no registry.
 *  Those are for PUBLISH (separate action). */
// GitHub username: 1–39 chars, alphanumerics + single hyphens, no leading/
// trailing hyphen. Validated before interpolating into the collaborators API
// path so a malformed login can't alter the request.
const VALID_GH_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

export async function deployApp(
  deployConfig: DeployConfig,
  files: Map<string, string>,
  env: DeployEnv,
  config: StoreConfig,
  onStatus: (status: DeployStatus) => void,
  creatorLogin?: string,
): Promise<void> {
  const ghApi = makeGhApi(env.GITHUB_TOKEN, config.agentName);
  const steps: DeployStep[] = [];
  onStatus({ phase: "provisioning", steps: [] });

  // Step 1: Create GitHub repo
  let repoCreated = false;
  const repoCheck = await ghApi(`/repos/${config.org}/${deployConfig.id}`);
  if (repoCheck.id) {
    steps.push({ name: "GitHub repo", status: "skip", detail: `${config.org}/${deployConfig.id} already exists` });
  } else {
    const createRepo = await ghApi(`/orgs/${config.org}/repos`, "POST", {
      name: deployConfig.id,
      private: false,
      description: deployConfig.description,
      auto_init: true,
      has_issues: true,
      has_projects: false,
      has_wiki: false,
    });
    if (createRepo.id) {
      repoCreated = true;
      steps.push({ name: "GitHub repo", status: "ok", detail: `Created ${config.org}/${deployConfig.id}` });
    } else {
      steps.push({ name: "GitHub repo", status: "fail", detail: createRepo.message || "Failed" });
      onStatus({ phase: "error", error: `GitHub repo creation failed: ${createRepo.message}` });
      return;
    }
  }
  onStatus({ phase: "provisioning", steps: [...steps] });

  // Step 1b: Give the signed-in creator push access to the repo the bot just
  // created for them. Only on a freshly-created repo (don't silently re-grant
  // access to a repo that already existed — the creator may have removed a
  // collaborator deliberately). Non-fatal: a failure here must not fail deploy.
  if (repoCreated && creatorLogin && VALID_GH_LOGIN.test(creatorLogin)) {
    try {
      const res = await fetch(
        `https://api.github.com/repos/${config.org}/${deployConfig.id}/collaborators/${creatorLogin}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${env.GITHUB_TOKEN}`,
            Accept: "application/vnd.github+json",
            "User-Agent": config.agentName,
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ permission: "push" }),
        },
      );
      // 201 = invitation created (outside collaborator), 204 = added directly
      // (already an org member). Both are success.
      steps.push({
        name: "Collaborator",
        status: res.ok ? "ok" : "fail",
        detail: res.ok ? `${creatorLogin} (push)` : `Could not add ${creatorLogin} (HTTP ${res.status})`,
      });
    } catch (err) {
      steps.push({ name: "Collaborator", status: "fail", detail: `Could not add ${creatorLogin}: ${String(err)}` });
    }
    onStatus({ phase: "provisioning", steps: [...steps] });
  }

  // Step 2: Create CF Pages project — try clean name first, prefix if squatted
  const cfBody = (name: string) => ({
    name,
    source: {
      type: "github",
      config: {
        owner: config.org,
        repo_name: deployConfig.id,
        production_branch: "main",
        deployments_enabled: true,
        production_deployments_enabled: true,
      },
    },
    build_config: { build_command: "npx pnpm@10 install && npx pnpm@10 build", destination_dir: "web/dist" },
    deployment_configs: { production: { env_vars: { NODE_VERSION: { value: "22" } } } },
  });

  // The CF Pages project name is the SINGLE source of truth shared with the
  // status/build-log lookups (infra.ts uses config.cfProjectName too). Deriving
  // it here — instead of a raw id or a nondeterministic `${id}-${Date.now()}`
  // fallback — guarantees the name we CREATE always equals the name those
  // lookups RECOMPUTE, so they can never diverge. For games this is the id
  // unchanged; for apps it's the free…app form the lookups already expect.
  const cfProjectName = config.cfProjectName(deployConfig.id);

  let cfProject = "";
  // Check if we already own this project
  const check = await cfApi(env.CF_API_TOKEN, env.CF_ACCOUNT_ID, `/accounts/${env.CF_ACCOUNT_ID}/pages/projects/${cfProjectName}`);
  if (check.success) {
    cfProject = cfProjectName;
    steps.push({ name: "CF Pages", status: "skip", detail: `${cfProjectName}.pages.dev` });
  } else {
    const result = await cfApi(
      env.CF_API_TOKEN,
      env.CF_ACCOUNT_ID,
      `/accounts/${env.CF_ACCOUNT_ID}/pages/projects`,
      "POST",
      cfBody(cfProjectName),
    );
    if (result.success) {
      cfProject = cfProjectName;
      steps.push({ name: "CF Pages", status: "ok", detail: `${cfProjectName}.pages.dev` });
    } else {
      // No renamed fallback: a project the lookups can't address by the
      // canonical name is worse than a clear failure (status/logs and the
      // custom-domain publish step would all point at the wrong project).
      const detail = result.errors?.[0]?.message || "Failed";
      steps.push({ name: "CF Pages", status: "fail", detail });
      onStatus({ phase: "error", error: `Could not create CF Pages project "${cfProjectName}": ${detail}` });
      return;
    }
  }
  onStatus({ phase: "provisioning", steps: [...steps] });

  // Step 3: Push files to GitHub → CF Pages auto-builds
  onStatus({ phase: "pushing", progress: "Creating file tree..." });
  await pushFilesToGitHub(deployConfig.id, files, env.GITHUB_TOKEN, config);
  steps.push({ name: "Pushing code", status: "ok", detail: "Code pushed" });
  onStatus({ phase: "provisioning", steps: [...steps] });

  // Step 4: Wait for CF Pages to build
  const previewUrl = `https://${cfProject}.pages.dev`;
  onStatus({ phase: "building", deployUrl: previewUrl });

  const deadline = Date.now() + 150_000; // 2.5 min
  while (Date.now() < deadline) {
    await sleep(8000);
    try {
      const deps = await cfApi(
        env.CF_API_TOKEN,
        env.CF_ACCOUNT_ID,
        `/accounts/${env.CF_ACCOUNT_ID}/pages/projects/${cfProject}/deployments?sort_by=created_on&sort_order=desc&per_page=1`,
      );
      const dep = deps.result?.[0];
      if (!dep) continue;
      if (dep.latest_stage?.status === "success") {
        onStatus({ phase: "live", appUrl: previewUrl });
        return;
      }
      if (dep.latest_stage?.status === "failure") {
        let buildLog = "";
        try {
          const logRes = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/pages/projects/${cfProject}/deployments/${dep.id}/history/logs`,
            { headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` } },
          );
          const logData = (await logRes.json()) as any;
          buildLog = ((logData.result?.data || []) as any[])
            .map((l: any) => l.line || "")
            .join("\n")
            .slice(-2000);
        } catch {}
        onStatus({ phase: "error", error: `Build failed.\n\n${buildLog || "(no logs)"}` });
        return;
      }
    } catch {}
  }
  onStatus({ phase: "live", appUrl: previewUrl }); // timeout — assume building
}

/** Push all files as a single commit via the Git Data API (tree + commit + ref). */
async function pushFilesToGitHub(repoId: string, files: Map<string, string>, token: string, config: StoreConfig): Promise<void> {
  const ghApi = makeGhApi(token, config.agentName);
  const repo = `${config.org}/${repoId}`;

  // Check if repo is empty (no refs). Git Data API doesn't work on empty repos.
  const ref = await ghApi(`/repos/${repo}/git/ref/heads/main`);
  if (!ref.object?.sha) {
    // Initialize empty repo with a seed file via Contents API (works on empty repos)
    const initContent = btoa("# Initial commit\n");
    await ghApi(`/repos/${repo}/contents/README.md`, "PUT", {
      message: "Initialize repo",
      content: initContent,
    });
    // Small delay for GitHub to process
    await sleep(1000);
  }

  // Now Git Data API works — get current HEAD
  const headRef = await ghApi(`/repos/${repo}/git/ref/heads/main`);
  const parentSha = headRef.object?.sha;

  // Create blobs for each file
  const treeItems: { path: string; mode: string; type: string; sha: string }[] = [];
  for (const [path, content] of files) {
    const blob = await ghApi(`/repos/${repo}/git/blobs`, "POST", {
      content,
      encoding: "utf-8",
    });
    if (!blob.sha) throw new Error(`Failed to create blob for ${path}: ${blob.message || "unknown error"}`);
    treeItems.push({ path, mode: "100644", type: "blob", sha: blob.sha });
  }

  // Create tree
  const tree = await ghApi(`/repos/${repo}/git/trees`, "POST", {
    tree: treeItems,
  });
  if (!tree.sha) throw new Error(`Failed to create tree: ${tree.message || "unknown error"}`);

  // Create commit
  const commit = await ghApi(`/repos/${repo}/git/commits`, "POST", {
    message: `Initial ${config.noun} — built with ${config.storeName} AI agent`,
    tree: tree.sha,
    parents: parentSha ? [parentSha] : [],
  });
  if (!commit.sha) throw new Error(`Failed to create commit: ${commit.message || "unknown error"}`);

  // Update main ref
  await ghApi(`/repos/${repo}/git/refs/heads/main`, "PATCH", {
    sha: commit.sha,
    force: true,
  });
}

/** Push an update to an existing repo (new commit on top of existing). */
export async function pushUpdate(
  appId: string,
  files: Map<string, string>,
  commitMessage: string,
  env: DeployEnv,
  config: StoreConfig,
): Promise<string> {
  const ghApi = makeGhApi(env.GITHUB_TOKEN, config.agentName);
  const repo = `${config.org}/${appId}`;

  const ref = await ghApi(`/repos/${repo}/git/ref/heads/main`);
  const parentSha = ref.object?.sha;
  if (!parentSha) return `Error: could not find HEAD for ${repo}. Is the ${config.noun} deployed?`;

  const treeItems: { path: string; mode: string; type: string; sha: string }[] = [];
  for (const [path, content] of files) {
    const blob = await ghApi(`/repos/${repo}/git/blobs`, "POST", {
      content,
      encoding: "utf-8",
    });
    if (!blob.sha) return `Error: failed to create blob for ${path}: ${blob.message || "unknown"}`;
    treeItems.push({ path, mode: "100644", type: "blob", sha: blob.sha });
  }

  const parentCommit = await ghApi(`/repos/${repo}/git/commits/${parentSha}`);
  if (!parentCommit.tree?.sha) return `Error: could not read parent commit tree for ${repo}.`;

  const tree = await ghApi(`/repos/${repo}/git/trees`, "POST", {
    base_tree: parentCommit.tree.sha,
    tree: treeItems,
  });

  const commit = await ghApi(`/repos/${repo}/git/commits`, "POST", {
    message: commitMessage,
    tree: tree.sha,
    parents: [parentSha],
  });

  const refUpdate = await ghApi(`/repos/${repo}/git/refs/heads/main`, "PATCH", {
    sha: commit.sha,
  });
  if (!refUpdate.ref) return `Error: failed to update ref for ${repo}: ${refUpdate.message || "unknown"}`;

  return `Pushed update to ${repo} (${commit.sha?.slice(0, 7)}). CF Pages will auto-deploy.`;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
