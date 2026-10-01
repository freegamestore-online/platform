/** Deploy: provision via CF/GitHub APIs, then push all files. */

import type { StoreConfig } from "./config";
import { makeGhApi, mapPool, resilientFetch } from "./ghfetch";
import { getTemplateFiles } from "./template";

export interface DeployConfig {
  id: string;
  name: string;
  category: string;
  icon: string;
  iconBg: string;
  description: string;
  /** Engine key the session was seeded from — admin generates the repo from the
   *  matching template so the committed lockfile fits the session's code. */
  template?: string;
  /** Paths the session deleted from the seed/scaffold, removed from the repo by
   *  the first push (#86). */
  deletedFiles?: Iterable<string>;
}

export interface DeployEnv {
  GITHUB_TOKEN: string;
  CF_API_TOKEN: string;
  CF_ACCOUNT_ID: string;
  /** Path B only: service binding to the admin worker + shared internal token,
   *  used to register the D1 host route + store registry entry. */
  ADMIN?: Fetcher;
  INTERNAL_TOKEN?: string;
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

/** Decide the status a deploy WAITER emits when it hits its deadline without ever
 *  observing a conclusive success. Never returns `live`: claiming "live" on a
 *  timeout masked builds that were still failing or that we simply couldn't
 *  reach. If the last poll erred (or no poll ever returned clean data) the status
 *  is genuinely UNKNOWN → `error`. Only when polling was clean but the build is
 *  merely slow do we stay in the calm "still building" state. Pure + exported so
 *  the timeout branch can be unit-tested without a 3-minute poll loop. */
export function deadlineStatus(
  sawPollError: boolean,
  lastError: string | null,
  appUrl: string,
  /** Last observed `status`/`conclusion` of the deploy run, or null if no run was
   *  ever seen. Defaults to in-progress so the pre-existing 3-arg callers (and
   *  their tests) keep the "clean but slow" meaning. */
  lastRunState: string | null = "in_progress",
): DeployStatus {
  if (sawPollError) {
    return {
      phase: "error",
      error: `Deploy status unknown — could not confirm the build finished${
        lastError ? ` (${lastError})` : ""
      }. It may still complete; check ${appUrl} shortly, or push an update to retry.`,
    };
  }
  // Polling was clean but NO run ever appeared for the pushed commit. That is not
  // "slow", it is a workflow that never started — reporting it as "still
  // building" is the calm lie #7 is about.
  if (lastRunState === null) {
    return {
      phase: "error",
      error: `No deploy workflow run appeared for this push within ${ACTIONS_DEPLOY_CEILING_MS / 60_000} minutes. The build never started — check the repo's Actions tab, then push an update to retry.`,
    };
  }
  return { phase: "building", deployUrl: appUrl };
}

/** Absolute hang guard for the Actions waiter. The loop's real exit condition is
 *  the run REACHING a conclusion; this only bounds a run that never finishes.
 *  The old 180s wall-clock was shorter than a routine cold-runner pipeline
 *  (pnpm install + vite build + headless-Chrome smoke test), so a slow build that
 *  was about to FAIL got reported as "still building" and ended the turn before
 *  the failure landed — the agent never saw it (#7). The turn itself budgets 30
 *  minutes (TURN_DEADLINE_MS), so this fits comfortably inside one turn. */
export const ACTIONS_DEPLOY_CEILING_MS = 10 * 60_000;

/** Pull the lines out of a raw Actions job log that actually explain a failure.
 *  Pure + exported so the filter is testable without a live run.
 *
 *  The smoke test throws `Error: Browser errors:\n<message>` (or "Game rendered
 *  no body/root/canvas content"), and a runtime crash surfaces as e.g.
 *  `TypeError: Cannot read properties of undefined` — all matched by the
 *  `[Ee]rror:` alternative. Falls back to the log tail so a failure with no
 *  recognised marker still yields something actionable. */
export function filterLogErrorLines(text: string): string[] {
  const interesting = text
    .split("\n")
    .filter((l: string) => /error TS\d|[Ee]rror:|Could not resolve|is not exported|Build failed|ELIFECYCLE|✗/.test(l))
    // biome-ignore lint/suspicious/noControlCharactersInRegex: strips ANSI colour codes, which start with ESC (\u001b).
    .map((l: string) => l.replace(/^[0-9T:.Z-]+\s*/, "").replace(/\u001b\[[0-9;]*m/g, ""))
    .slice(-25);
  if (interesting.length) return interesting;
  return text
    .split("\n")
    .slice(-30)
    .map((l: string) => l.replace(/^[0-9T:.Z-]+\s*/, ""));
}

/** Describe a FAILED deploy run: the failing job/step name plus the error lines
 *  from that job's raw log, in ONE jobs fetch.
 *
 *  The log pull is what closes the recovery loop. Before this, a failed deploy
 *  told the agent only "deploy › Smoke test built game" — a step name it cannot
 *  act on — and the actual browser error was reachable only if the model chose
 *  to call get_build_logs. Now it rides along in the tool result automatically.
 *  Every step is best-effort: a failure to read logs must still report a
 *  failure, never a hang. */
export async function describeFailedRun(
  repoId: string,
  runId: number | string,
  env: DeployEnv,
  config: StoreConfig,
): Promise<{ detail: string; errorLines: string[] }> {
  const ghApi = makeGhApi(env.GITHUB_TOKEN, config.agentName);
  let detail = "";
  let failingJobId: number | null = null;
  try {
    const jobs = await ghApi(`/repos/${config.org}/${repoId}/actions/runs/${runId}/jobs`);
    const failedJob = (jobs.jobs || []).find((j: any) => j.conclusion === "failure");
    const failedStep = failedJob?.steps?.find((s: any) => s.conclusion === "failure");
    detail = failedJob ? `${failedJob.name}${failedStep ? " › " + failedStep.name : ""}` : "";
    failingJobId = failedJob?.id ?? null;
  } catch (err) {
    console.error(`[deploy] Actions job detail fetch failed for ${config.org}/${repoId}: ${String(err)}`);
    return { detail, errorLines: [] };
  }
  if (failingJobId === null) return { detail, errorLines: [] };
  try {
    const logRes = await resilientFetch(`https://api.github.com/repos/${config.org}/${repoId}/actions/jobs/${failingJobId}/logs`, {
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "User-Agent": config.agentName,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!logRes.ok) return { detail, errorLines: [] };
    return { detail, errorLines: filterLogErrorLines(await logRes.text()) };
  } catch (err) {
    console.error(`[deploy] Actions job log fetch failed for ${config.org}/${repoId}: ${String(err)}`);
    return { detail, errorLines: [] };
  }
}

async function cfApi(token: string, _accountId: string, path: string, method = "GET", body?: unknown) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json() as Promise<any>;
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
  seed?: Record<string, string>,
  /** Called once the id is confirmed as this creator's (never for an id that
   *  belongs to someone else) — the point at which the session may bind it. */
  onProvisioned?: () => void,
): Promise<void> {
  const ghApi = makeGhApi(env.GITHUB_TOKEN, config.agentName);
  const steps: DeployStep[] = [];
  onStatus({ phase: "provisioning", steps: [] });

  // FGS games (Path B): admin owns provisioning end-to-end — it generates the
  // repo from template-game-canvas (substituted per A3), writes the host route +
  // registry entry, and invites the creator. The agent then layers ONLY the
  // game source it authored on top (delta vs. the seed template), so admin's
  // generated scaffold survives. No agent repo-creation, no CF Pages.
  if (config.pathB) {
    return deployPathB(deployConfig, files, env, config, onStatus, creatorLogin, seed, onProvisioned);
  }
  onProvisioned?.();

  // Step 1: Create GitHub repo (FAS apps — CF Pages flow)
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
      const res = await fetch(`https://api.github.com/repos/${config.org}/${deployConfig.id}/collaborators/${creatorLogin}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "User-Agent": config.agentName,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ permission: "push" }),
      });
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
  let sawPollError = false;
  let lastError: string | null = null;
  while (Date.now() < deadline) {
    await sleep(8000);
    try {
      const deps = await cfApi(
        env.CF_API_TOKEN,
        env.CF_ACCOUNT_ID,
        `/accounts/${env.CF_ACCOUNT_ID}/pages/projects/${cfProject}/deployments?sort_by=created_on&sort_order=desc&per_page=1`,
      );
      sawPollError = false; // this poll returned cleanly
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
        } catch (err) {
          console.error(`[deploy] CF Pages build-log fetch failed for ${cfProject}: ${String(err)}`);
        }
        onStatus({ phase: "error", error: `Build failed.\n\n${buildLog || "(no logs)"}` });
        return;
      }
    } catch (err) {
      sawPollError = true;
      lastError = String(err);
      console.error(`[deploy] CF Pages deployment poll failed for ${cfProject}: ${lastError}`);
    }
  }
  // Deadline hit WITHOUT a confirmed success. Never claim "live" — that masked a
  // still-failing or unreachable build. Stay calm ("still building") only when
  // the last poll was clean; otherwise the status is genuinely unknown.
  onStatus(deadlineStatus(sawPollError, lastError, previewUrl));
}

/** Path B: register the D1 host route + store registry entry via the admin
 *  Worker (which owns the shared `fas` D1 + registry). The agent already created
 *  the repo, so admin's provision is idempotent here — it skips repo creation
 *  and just writes the route + registry. Auth is the shared internal token
 *  (the agent holds no user fgs_token at deploy time). */
async function registerViaAdmin(
  deployConfig: DeployConfig,
  env: DeployEnv,
  config: StoreConfig,
  creatorLogin?: string,
): Promise<DeployStep & { conflict?: boolean }> {
  if (!env.ADMIN || !env.INTERNAL_TOKEN) {
    return { name: "Store registry", status: "fail", detail: "admin binding / internal token not configured" };
  }
  try {
    const res = await env.ADMIN.fetch(`https://admin.${config.domain}/api/provision`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Token": env.INTERNAL_TOKEN },
      body: JSON.stringify({
        id: deployConfig.id,
        name: deployConfig.name,
        category: deployConfig.category,
        icon: deployConfig.icon,
        iconBg: deployConfig.iconBg,
        description: deployConfig.description,
        ...(creatorLogin ? { creatorGithub: creatorLogin } : {}),
        ...(deployConfig.template ? { template: deployConfig.template } : {}),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      steps?: { name: string; status: string; detail: string }[];
      error?: string;
      conflict?: boolean;
    };
    if (res.ok && data.success) {
      return { name: "Store registry", status: "ok", detail: `${deployConfig.id} listed + host route written` };
    }
    const failed = data.steps?.find((s) => s.status === "fail");
    return {
      name: "Store registry",
      status: "fail",
      detail: failed?.detail || data.error || `admin returned HTTP ${res.status}`,
      ...(res.status === 409 || data.conflict === true ? { conflict: true } : {}),
    };
  } catch (err) {
    return { name: "Store registry", status: "fail", detail: String(err) };
  }
}

/** Report a CONCLUDED build outcome to admin, which flips the game's registry
 *  `status` (#22). Provisioning writes `pending` before the build runs, so until
 *  this lands the store must not claim the game is live — the host answers 200
 *  for the template scaffold either way.
 *
 *  Strictly best-effort: a game's deploy is NOT failed by a failure to report it.
 *  Admin's hourly reconcile re-derives the same outcome from deploy.yml, so the
 *  worst case of a dropped call is that the flip is late, not lost. */
export async function reportBuildStatus(repoId: string, status: "live" | "failed", env: DeployEnv, config: StoreConfig): Promise<void> {
  if (!env.ADMIN || !env.INTERNAL_TOKEN) return;
  try {
    const res = await env.ADMIN.fetch(`https://admin.${config.domain}/api/game-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Token": env.INTERNAL_TOKEN },
      body: JSON.stringify({ id: repoId, status }),
    });
    if (!res.ok) {
      console.error(`[deploy] build-status report for ${repoId} → ${status}: HTTP ${res.status}`);
    }
  } catch (err) {
    console.error(`[deploy] build-status report for ${repoId} → ${status} failed: ${String(err)}`);
  }
}

/** Canonical APPNAME substitution (shared with infra-exec at deploy time):
 *  the id (slug) in package.json manifests, the display name everywhere else.
 *  Mutates `files` in place. Mirrors admin's `substituteTemplatePlaceholders`
 *  rule exactly so the agent and admin never diverge on a re-authored file. */
export function substituteAppName(files: Map<string, string>, appId: string, appName: string): void {
  // Function replacer: a display name containing `$&`/`$1`/`$'` must be inserted
  // literally, not interpreted as a replacement pattern (which would corrupt it).
  const nameFn = () => appName;
  for (const [path, content] of files) {
    if (!content.includes("APPNAME")) continue;
    if (path.includes("package.json")) {
      // Manifests use the slug (npm name grammar) — never the display name.
      files.set(path, content.replace(/APPNAME/g, appId));
    } else if (path.endsWith("index.html")) {
      // index.html carries BOTH the cookieless analytics slug (?app=APPNAME → the
      // game ID) AND the human <title> (APPNAME → display name). Rewrite the
      // analytics slug to the ID FIRST, then the remaining APPNAMEs to the display
      // name — matching admin. A blanket APPNAME→display-name replace would push
      // `app=<displayName>` and break this game's analytics attribution.
      files.set(path, content.replace(/app=APPNAME/g, `app=${appId}`).replace(/APPNAME/g, nameFn));
    } else {
      files.set(path, content.replace(/APPNAME/g, nameFn));
    }
  }
}

/** The subset of `files` the agent actually AUTHORED — i.e. that differs from
 *  the (substituted) template scaffold. Everything unchanged is left to admin's
 *  generated + substituted repo (package.json, deploy.yml, compliance.yml, the
 *  analytics-wired index.html, the committed lockfile), which a base_tree merge
 *  preserves. `files` is already APPNAME-substituted by the time we get here, so
 *  we substitute the baseline identically to compare like-for-like. */
export function gameSourceDelta(
  files: Map<string, string>,
  config: StoreConfig,
  appId: string,
  appName: string,
  seed?: Record<string, string>,
): Map<string, string> {
  // Baseline against the ACTUAL seed the session started from (the fetched
  // template-game-canvas) — not the bundled inline template, which is
  // structurally different (local GameShell vs. the SDK). Falls back to the
  // inline template for legacy sessions / non-Path-B stores.
  const baseline = new Map(Object.entries(seed ?? getTemplateFiles(config)));
  substituteAppName(baseline, appId, appName);
  const delta = new Map<string, string>();
  for (const [path, content] of files) {
    if (baseline.get(path) !== content) delta.set(path, content);
  }
  return delta;
}

/** Poll until the repo's main branch exists (admin's /generate +
 *  APPNAME-substitution commits have landed). Admin already waits for the repo
 *  before returning, so this is usually immediate — a short safety poll. */
async function waitForRef(repoId: string, env: DeployEnv, config: StoreConfig): Promise<boolean> {
  const ghApi = makeGhApi(env.GITHUB_TOKEN, config.agentName);
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const ref = await ghApi(`/repos/${config.org}/${repoId}/git/ref/heads/main`);
    if (ref.object?.sha) return true;
    await sleep(2000);
  }
  return false;
}

/** Path B deploy (FGS games): the ONE canonical provision path.
 *  1. registerViaAdmin — admin generates the repo from template-game-canvas
 *     (substituted), writes the host route + registry entry, invites the creator.
 *  2. Wait for the generated main branch.
 *  3. Push ONLY the agent-authored game source (delta) via a base_tree merge, so
 *     admin's generated scaffold + lockfile survive.
 *  4. Wait for the Actions deploy (compliance + build + R2 sync). */
async function deployPathB(
  deployConfig: DeployConfig,
  files: Map<string, string>,
  env: DeployEnv,
  config: StoreConfig,
  onStatus: (status: DeployStatus) => void,
  creatorLogin?: string,
  seed?: Record<string, string>,
  onProvisioned?: () => void,
): Promise<void> {
  const steps: DeployStep[] = [];
  onStatus({ phase: "provisioning", steps: [] });

  // 1. Provision via admin (idempotent — skips repo creation on re-deploy).
  const { conflict, ...reg } = await registerViaAdmin(deployConfig, env, config, creatorLogin);
  steps.push(reg);
  onStatus({ phase: "provisioning", steps: [...steps] });
  // Admin is the arbiter of who owns an id (#88). If it belongs to another
  // creator — including a concurrent deploy that won the race — never bind it,
  // or the session would be authorized to push_update someone else's game.
  if (conflict) {
    onStatus({ phase: "error", error: `The ${config.noun} ID "${deployConfig.id}" belongs to another creator: ${reg.detail}` });
    return;
  }
  // Bound even if provisioning failed for another reason: the id is this
  // creator's, and keeping it lets a failed first deploy recover via push_update.
  onProvisioned?.();
  if (reg.status === "fail") {
    onStatus({ phase: "error", error: `Could not provision the ${config.noun}: ${reg.detail}` });
    return;
  }

  // 2. Wait for the generated repo's main branch.
  onStatus({ phase: "pushing", progress: "Preparing repository..." });
  if (!(await waitForRef(deployConfig.id, env, config))) {
    onStatus({ phase: "error", error: `Repository ${config.org}/${deployConfig.id} was not ready in time. Retry the deploy.` });
    return;
  }

  // 3. Layer the agent's game source on top (delta only). If the agent changed
  //    nothing beyond the scaffold, admin's generate/substitution commit already
  //    triggered the deploy workflow — skip the push and go straight to waiting.
  const delta = gameSourceDelta(files, config, deployConfig.id, deployConfig.name, seed);
  if (delta.size > 0) {
    onStatus({ phase: "pushing", progress: `Pushing ${delta.size} file${delta.size === 1 ? "" : "s"}...` });
    const push = await pushUpdate(
      deployConfig.id,
      delta,
      `Build ${deployConfig.name} — ${config.storeName} AI agent`,
      env,
      config,
      deployConfig.deletedFiles,
    );
    if (push.startsWith("Error")) {
      steps.push({ name: "Pushing code", status: "fail", detail: push });
      onStatus({ phase: "error", error: push });
      return;
    }
    steps.push({ name: "Pushing code", status: "ok", detail: `${delta.size} file${delta.size === 1 ? "" : "s"} pushed` });
  } else {
    steps.push({ name: "Pushing code", status: "skip", detail: "No changes beyond the template scaffold" });
  }
  onStatus({ phase: "provisioning", steps: [...steps] });

  // 4. Wait for the Actions deploy (build → R2 sync).
  const appUrl = `https://${deployConfig.id}.${config.domain}`;
  onStatus({ phase: "building", deployUrl: appUrl });
  await waitForActionsDeploy(deployConfig.id, env, config, onStatus, appUrl);
}

/** Path B: poll the repo's GitHub Actions runs until the deploy workflow (build
 *  → R2 sync) finishes. Success → live; failure → surface the failing job/step.
 *  Replaces CF Pages deployment polling. */
export async function waitForActionsDeploy(
  repoId: string,
  env: DeployEnv,
  config: StoreConfig,
  onStatus: (s: DeployStatus) => void,
  appUrl: string,
): Promise<void> {
  const ghApi = makeGhApi(env.GITHUB_TOKEN, config.agentName);
  // The loop exits when the RUN reaches a conclusion, not when a wall-clock timer
  // fires. The ceiling is only a hang guard (see ACTIONS_DEPLOY_CEILING_MS).
  const deadline = Date.now() + ACTIONS_DEPLOY_CEILING_MS;
  let sawPollError = false;
  let lastError: string | null = null;
  /** Last observed run state; null until a run for this workflow is seen at all. */
  let lastRunState: string | null = null;
  while (Date.now() < deadline) {
    await sleep(8000);
    try {
      // Filter to the deploy workflow specifically — a repo can carry several
      // workflows (ci/compliance/deploy), so "latest run of any workflow" would
      // read the wrong conclusion.
      const runs = await ghApi(`/repos/${config.org}/${repoId}/actions/workflows/deploy.yml/runs?per_page=1`);
      sawPollError = false; // this poll returned cleanly
      const run = runs.workflow_runs?.[0];
      if (!run) {
        // No run yet — the push may not have registered. Keep waiting, but leave
        // lastRunState null so the ceiling can tell "never started" from "slow".
        continue;
      }
      if (run.status !== "completed") {
        // queued / in_progress / waiting / requested — genuinely still building.
        lastRunState = run.status || "in_progress";
        continue;
      }
      if (run.conclusion === "success") {
        // Flip the registry to live BEFORE reporting live upstream, so the store
        // and game_info agree with what the creator is being shown.
        await reportBuildStatus(repoId, "live", env, config);
        onStatus({ phase: "live", appUrl });
        return;
      }
      // A cancelled run is EXPECTED here: Path B provisioning lands several
      // commits in quick succession (admin's /generate, its APPNAME
      // substitution, then the agent's delta push), and deploy.yml's
      // `concurrency: cancel-in-progress` cancels the earlier runs. Don't treat
      // that as a deploy failure — keep polling for the final run to finish.
      if (run.conclusion === "cancelled") {
        lastRunState = "cancelled";
        continue;
      }
      if (["failure", "timed_out"].includes(run.conclusion)) {
        // Pull the failing job/step AND the error lines from its raw log, so the
        // tool result the model sees carries the actual browser error rather than
        // a step name it cannot act on (#7).
        const { detail, errorLines } = await describeFailedRun(repoId, run.id, env, config);
        // Only downgrades a game that has never shipped — admin refuses to move a
        // `live` game to `failed`, because R2 still serves its last good build.
        await reportBuildStatus(repoId, "failed", env, config);
        const logs = errorLines.length ? `\n\n── error lines from the failing job ──\n${errorLines.join("\n").slice(0, 4000)}` : "";
        onStatus({
          phase: "error",
          error: `Deploy workflow ${run.conclusion}${detail ? `: ${detail}` : ""}. See ${run.html_url || "the repo's Actions tab"} for logs.${logs}`,
        });
        return;
      }
      // Any other conclusion (skipped / neutral / action_required) is not a
      // verdict we can act on — record it and keep waiting for a real one.
      lastRunState = run.conclusion || "completed";
    } catch (err) {
      sawPollError = true;
      lastError = String(err);
      console.error(`[deploy] Actions deploy poll failed for ${config.org}/${repoId}: ${lastError}`);
    }
  }
  // Ceiling hit WITHOUT a conclusion. Never claim "live" — that reported a
  // failing/stuck build as shipped. Stay calm ("still building") only when
  // polling was clean AND a run was actually observed running; a clean poll that
  // never saw a run at all is a workflow that never started, not a slow one.
  onStatus(deadlineStatus(sawPollError, lastError, appUrl, lastRunState));
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
  /** Paths to remove from the repo. A base_tree commit keeps every path it
   *  isn't given, so without explicit `sha: null` entries a delete_file never
   *  left the session (#86). Only paths present in the parent tree are sent,
   *  so stale or never-committed entries are harmless. */
  deletions: Iterable<string> = [],
): Promise<string> {
  const ghApi = makeGhApi(env.GITHUB_TOKEN, config.agentName);
  const repo = `${config.org}/${appId}`;

  const ref = await ghApi(`/repos/${repo}/git/ref/heads/main`);
  const parentSha = ref.object?.sha;
  if (!parentSha) return `Error: could not find HEAD for ${repo}. Is the ${config.noun} deployed?`;

  const treeItems: { path: string; mode: string; type: string; sha: string | null }[] = [];
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

  const pending = [...new Set(deletions)].filter((path) => !files.has(path));
  let deleted = 0;
  if (pending.length > 0) {
    let base: { tree?: unknown; truncated?: boolean; message?: string };
    try {
      base = await ghApi(`/repos/${repo}/git/trees/${parentCommit.tree.sha}?recursive=1`);
    } catch (err) {
      base = { message: String(err) };
    }
    // Fail rather than push without the deletions: silently keeping a deleted
    // file is exactly the bug this guards against.
    if (!Array.isArray(base.tree) || base.truncated) {
      return `Error: could not read the repo tree for ${repo} to apply file deletions: ${base.message || "tree unavailable or truncated"}`;
    }
    const present = new Set((base.tree as { path?: string; type?: string }[]).filter((e) => e.type === "blob").map((e) => e.path));
    for (const path of pending) {
      if (!present.has(path)) continue;
      treeItems.push({ path, mode: "100644", type: "blob", sha: null });
      deleted++;
    }
  }

  const tree = await ghApi(`/repos/${repo}/git/trees`, "POST", {
    base_tree: parentCommit.tree.sha,
    tree: treeItems,
  });
  // Guard tree.sha (mirrors pushFilesToGitHub): a non-thrown 422 (e.g. invalid
  // base_tree) returns a body with no sha. Without this, we POST the commit with
  // tree:undefined → the failure surfaces as a misleading "failed to update ref"
  // that hides the real cause (tree creation).
  if (!tree.sha) return `Error: failed to create tree for ${repo}: ${tree.message || "unknown"}`;

  const commit = await ghApi(`/repos/${repo}/git/commits`, "POST", {
    message: commitMessage,
    tree: tree.sha,
    parents: [parentSha],
  });
  if (!commit.sha) return `Error: failed to create commit for ${repo}: ${commit.message || "unknown"}`;

  const refUpdate = await ghApi(`/repos/${repo}/git/refs/heads/main`, "PATCH", {
    sha: commit.sha,
  });
  if (!refUpdate.ref) return `Error: failed to update ref for ${repo}: ${refUpdate.message || "unknown"}`;

  const removed = deleted > 0 ? `, removed ${deleted} deleted file${deleted === 1 ? "" : "s"}` : "";
  return `Pushed update to ${repo} (${commit.sha?.slice(0, 7)}${removed}). CI will build and deploy.`;
}

// ── Repo import (open-existing) — read a game's committed text source so a
// VibeCode session can bind to it and push_update instead of overwrite. ──
const IMPORT_SKIP_DIRS = ["node_modules/", "dist/", "build/", ".git/", ".wrangler/"];
const IMPORT_SKIP_BASENAMES = new Set(["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lockb"]);
// Binary/asset extensions we don't import (they stay in the repo; a base_tree
// push preserves them). SVG is text/XML, so it's intentionally NOT here.
const IMPORT_BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|bmp|woff2?|ttf|otf|eot|mp3|wav|ogg|m4a|mp4|webm|mov|pdf|zip|gz|tar|wasm|bin)$/i;
const IMPORT_PER_FILE_MAX = 256 * 1024;
// Kept comfortably UNDER the ~2 MB DO value cap: the imported files are stored
// as `session.files` alongside the transcript + seed in the SAME persisted blob,
// so an import that filled the whole 2 MB would leave no room for messages and
// brick save(). 1.2 MB of source leaves headroom for the rest of the session.
const IMPORT_TOTAL_MAX = 1.2 * 1024 * 1024;
const IMPORT_MAX_FILES = 200;
/** Bound the blob-read fan-out so a large repo import can't fire hundreds of
 *  concurrent GETs and trip GitHub's secondary rate limit. */
const IMPORT_BLOB_CONCURRENCY = 8;

/** Read a repo's committed text files via the Git Data API (recursive tree +
 *  blobs). Skips build/dep dirs, lockfiles, and binaries, and enforces
 *  per-file / total / file-count caps so an import can't blow the DO's
 *  storage. Throws on an empty repo or a tree with no importable files. */
/** Current commit SHA of a repo's main branch (one cheap ref call). Used to
 *  decide whether a bound session needs a re-import: if the repo HEAD hasn't
 *  moved since the last import, the session's files are already current and we
 *  can skip the (much heavier) tree+blob walk. Returns null if unreachable. */
export async function fetchRepoHeadSha(repoId: string, token: string, config: StoreConfig): Promise<string | null> {
  const ghApi = makeGhApi(token, config.agentName);
  try {
    const ref = await ghApi(`/repos/${config.org}/${repoId}/git/ref/heads/main`);
    return typeof ref.object?.sha === "string" ? ref.object.sha : null;
  } catch {
    return null;
  }
}

export async function fetchRepoFiles(repoId: string, token: string, config: StoreConfig): Promise<Map<string, string>> {
  const ghApi = makeGhApi(token, config.agentName);
  const repo = `${config.org}/${repoId}`;

  const ref = await ghApi(`/repos/${repo}/git/ref/heads/main`);
  const headSha = ref.object?.sha;
  if (!headSha) throw new Error(`no main branch for ${repo} — is the ${config.noun} deployed?`);

  const tree = await ghApi(`/repos/${repo}/git/trees/${headSha}?recursive=1`);
  if (!Array.isArray(tree.tree)) throw new Error(`could not read repo tree for ${repo}`);

  // Select eligible blobs within the caps FIRST, using the tree's own sizes, so
  // we never over-fetch — then read the selected blobs concurrently (much faster
  // than a sequential walk on a ~25-file template).
  const eligible: { path: string; sha: string }[] = [];
  let planned = 0;
  for (const entry of tree.tree) {
    if (entry.type !== "blob" || typeof entry.path !== "string" || typeof entry.sha !== "string") continue;
    const path: string = entry.path;
    if (IMPORT_SKIP_DIRS.some((d) => path.startsWith(d) || path.includes(`/${d}`))) continue;
    if (IMPORT_SKIP_BASENAMES.has(path.split("/").pop() || "")) continue;
    if (IMPORT_BINARY_EXT.test(path)) continue;
    const size = typeof entry.size === "number" ? entry.size : 0;
    if (size > IMPORT_PER_FILE_MAX) continue;
    if (eligible.length >= IMPORT_MAX_FILES) break;
    if (planned + size > IMPORT_TOTAL_MAX) break;
    planned += size;
    eligible.push({ path, sha: entry.sha });
  }

  const entries = await mapPool(eligible, IMPORT_BLOB_CONCURRENCY, async ({ path, sha }) => {
    const blob = await ghApi(`/repos/${repo}/git/blobs/${sha}`);
    if (blob.encoding !== "base64" || typeof blob.content !== "string") return null;
    const bytes = Uint8Array.from(atob(blob.content.replace(/\n/g, "")), (c) => c.charCodeAt(0));
    if (bytes.includes(0)) return null; // NUL byte → binary, skip
    // Default TextDecoder is non-fatal (invalid bytes → U+FFFD), which is fine
    // — we've already skipped NUL-containing blobs as binary above.
    return [path, new TextDecoder("utf-8").decode(bytes)] as const;
  });

  const files = new Map<string, string>(entries.filter((e): e is readonly [string, string] => e !== null));
  if (files.size === 0) throw new Error(`no importable text files found in ${repo}`);
  return files;
}

/** Seed a new VibeCode session from the store's canonical template repo
 *  (template-game-canvas for FGS games) so the agent authors against the SAME
 *  SDK-based scaffold admin's /generate produces. Returns null for non-Path-B
 *  stores or when the fetch fails, so the caller falls back to the bundled
 *  inline template. */
export async function fetchTemplateSeed(config: StoreConfig, token: string, templateRepo?: string): Promise<Record<string, string> | null> {
  if (!config.pathB || !config.templateRepo) return null;
  try {
    const files = await fetchRepoFiles(templateRepo ?? config.templateRepo, token, config);
    return Object.fromEntries(files);
  } catch {
    return null;
  }
}

/** Resolve the file set a BRAND-NEW session seeds from, given the result of
 *  fetchTemplateSeed. Path B stores (FGS games) MUST author against the fetched
 *  SDK-based template (template-game-canvas): their system prompt tells the model
 *  to import `@freegamestore/games`, which the bundled inline GAME_FILES scaffold
 *  does NOT provide. Seeding that inline fallback on a fetch failure produces a
 *  game that references a package that isn't there → a silent, unbuildable
 *  deploy. So when the template fetch failed (`seed === null`) we HARD-FAIL with a
 *  clear, user-surfaced error rather than seed a prompt-incompatible template.
 *  Non-Path-B stores (FAS apps) keep the inline template as a valid fallback. */
export function resolveSeedFiles(config: StoreConfig, seed: Record<string, string> | null): Record<string, string> {
  if (config.pathB && !seed) {
    throw new Error(
      `Could not load the ${config.storeName} ${config.noun} template — the studio can't start a new ${config.noun} right now. Please retry in a moment.`,
    );
  }
  return { ...(seed ?? getTemplateFiles(config)) };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
