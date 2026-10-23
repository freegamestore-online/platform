/** Deploy: provision via CF/GitHub APIs, then push all files. */

import { commitFiles } from "@freegamestore/contracts";
import type { StoreConfig } from "./config";
import { getFailedRunDetails } from "./infra";
import { makeGhApi, mapPool } from "./ghfetch";
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

/** Describe a failed deploy run: the failing job/step name plus error lines from that job's log.
 *  The log pull closes the recovery loop — before this, a failed deploy told the agent only
 *  "deploy › Smoke test built game" (a step name it cannot act on), and the actual browser
 *  error was reachable only if the model called get_build_logs. Now it rides along automatically.
 *  Uses the shared helper from infra.ts so get_build_logs and deploy status auto-injection
 *  never disagree about what counts as an error line. */
export async function describeFailedRun(
  repoId: string,
  runId: number | string,
  env: DeployEnv,
  config: StoreConfig,
): Promise<{ detail: string; errorLines: string[] }> {
  return getFailedRunDetails(config.org, repoId, runId, env, config);
}

/** Deploy = create repo + push code via Path B (admin-provisioned).
 *  No CF Pages, no DNS, no registry — those are for PUBLISH (separate action). */

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
  return deployPathB(deployConfig, files, env, config, onStatus, creatorLogin, seed, onProvisioned);
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
      files.set(path, content.replace(/app=APPNAME/g, `app=${appId}`).replace(/https:\/\/APPNAME\.freegamestore\.online/g, `https://${appId}.freegamestore.online`).replace(/APPNAME/g, () => appName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')));
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
  // The commit whose deploy run decides this deploy's outcome (#87).
  let deploySha: string | null = null;
  if (delta.size > 0) {
    onStatus({ phase: "pushing", progress: `Pushing ${delta.size} file${delta.size === 1 ? "" : "s"}...` });
    const push = await pushCommit(
      deployConfig.id,
      delta,
      `Build ${deployConfig.name} — ${config.storeName} AI agent`,
      env,
      config,
      deployConfig.deletedFiles,
    );
    if (!push.sha) {
      steps.push({ name: "Pushing code", status: "fail", detail: push.message });
      onStatus({ phase: "error", error: push.message });
      return;
    }
    deploySha = push.sha;
    steps.push({ name: "Pushing code", status: "ok", detail: `${delta.size} file${delta.size === 1 ? "" : "s"} pushed` });
  } else {
    steps.push({ name: "Pushing code", status: "skip", detail: "No changes beyond the template scaffold" });
    // Nothing pushed: admin's latest provisioning commit is what deploys.
    deploySha = await fetchRepoHeadSha(deployConfig.id, env.GITHUB_TOKEN, config);
  }
  onStatus({ phase: "provisioning", steps: [...steps] });

  // 4. Wait for the Actions deploy (build → R2 sync).
  const appUrl = `https://${deployConfig.id}.${config.domain}`;
  onStatus({ phase: "building", deployUrl: appUrl });
  await waitForActionsDeploy(deployConfig.id, env, config, onStatus, appUrl, deploySha);
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
  /** SHA of the commit just pushed. Its run is the one to wait for: polling
   *  "the latest deploy.yml run" read the PREVIOUS run whenever GitHub had not
   *  registered the new one yet (an old failure with stale logs, or an old
   *  success reported as live before the new build passed) (#87). */
  headSha?: string | null,
): Promise<void> {
  const ghApi = makeGhApi(env.GITHUB_TOKEN, config.agentName);
  // Which commit's run to follow; null = the latest run (no SHA known, or our
  // run was superseded by a newer push).
  let follow: string | null = headSha ?? null;
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
      const filter = follow ? `head_sha=${encodeURIComponent(follow)}&per_page=1` : "per_page=1";
      const runs = await ghApi(`/repos/${config.org}/${repoId}/actions/workflows/deploy.yml/runs?${filter}`);
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
        // Our commit's run being cancelled means a NEWER push superseded it;
        // that newer run is what will actually ship, so follow it from here.
        follow = null;
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

/** Push an update to an existing repo (new commit on top of existing). */
export interface PushResult {
  /** Human-readable outcome; starts with "Error" on failure. */
  message: string;
  /** Full SHA of the commit that was pushed (null on failure). The deploy
   *  waiter needs it to follow THIS commit's run, not the latest one (#87). */
  sha: string | null;
}

/** Push the session's files as one commit on main; see pushUpdate. */
export async function pushCommit(
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
): Promise<PushResult> {
  const repo = `${config.org}/${appId}`;

  try {
    // Convert Map<string, string> to Record<string, string>
    const filesRecord: Record<string, string> = {};
    for (const [path, content] of files) {
      filesRecord[path] = content;
    }

    // Use shared commitFiles helper from contracts package
    const result = await commitFiles({
      org: config.org,
      repo: appId,
      token: env.GITHUB_TOKEN,
      files: filesRecord,
      deletions: Array.from(deletions),
      message: commitMessage,
      encoding: 'utf-8',
    });

    const removed = result.deletedCount > 0 ? `, removed ${result.deletedCount} deleted file${result.deletedCount === 1 ? "" : "s"}` : "";

    return {
      message: `Pushed update to ${repo} (${result.sha.slice(0, 7)}${removed}). CI will build and deploy.`,
      sha: result.sha,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Preserve specific error patterns from commitFiles for test expectations
    if (message.startsWith("could not read the repo tree") ||
        message.startsWith("repo seed failed") ||
        message.startsWith("blob create failed") ||
        message.startsWith("tree create failed") ||
        message.startsWith("commit create failed") ||
        message.startsWith("ref update failed")) {
      return {
        message: `Error: ${message}`,
        sha: null,
      };
    }
    return {
      message: `Error: failed to push to ${repo}: ${message}`,
      sha: null,
    };
  }
}

/** pushCommit, returning only the outcome message. */
export async function pushUpdate(...args: Parameters<typeof pushCommit>): Promise<string> {
  return (await pushCommit(...args)).message;
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
