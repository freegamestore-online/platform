/** Execute infra tools server-side. Extracted from session.ts to keep it manageable. */

import { checkBuildSanity, formatSanityBlock } from "./build-sanity";
import type { StoreConfig } from "./config";
import type { DeployEnv, DeployStatus } from "./deploy";
import { deployApp, pushUpdate, substituteAppName, waitForActionsDeploy } from "./deploy";
import { checkDeployStatus, fetchUrl, getAuditResults, getBuildLogs, getCIResults, listDeployed } from "./infra";
import type { ToolCall } from "./providers/types";

interface ExecContext {
  appId: string | null;
  files: Map<string, string>;
  env: DeployEnv;
  config: StoreConfig;
  /** GitHub login of the signed-in creator; added as a repo collaborator on deploy. */
  creatorLogin?: string;
  /** The template snapshot the session was seeded from — the delta baseline for
   *  Path B deploys (only the files the agent changed vs. this are pushed). */
  seed?: Record<string, string>;
  /** Public engine key the session was seeded from — forwarded to admin so the
   *  generated repo's template (and its lockfile) match the session's code. */
  engine?: string;
  onDeployStatus: (status: DeployStatus) => void;
  onAppDeployed: (id: string, name: string) => void;
}

/** Execute a single infra tool. Returns the result string. */
/** Infra tools that operate on a specific item and therefore REQUIRE a valid
 *  string id. A tool call with a missing/blank id used to slip past validation
 *  (`if (tc.input.id)` was falsy) and write the literal string "undefined" into
 *  the repo path / package.json. Reject it up front. */
const ID_REQUIRED = new Set(["deploy", "push_update", "check_deploy_status", "get_build_logs", "get_ci_results", "get_audit_results"]);

export async function executeInfraTool(tc: ToolCall, ctx: ExecContext): Promise<string> {
  const { config } = ctx;

  // Reject a missing/invalid id BEFORE any id-dependent logic, so no tool ever
  // interpolates `undefined` into a repo name, path, or package.json.
  if (ID_REQUIRED.has(tc.name)) {
    const rawId = tc.input.id;
    if (typeof rawId !== "string" || rawId.trim() === "") {
      return `Error: ${tc.name} requires a valid ${config.noun} id.`;
    }
  }

  // Authorization: scope write tools to the session's own item
  const targetId = tc.input.id as string | undefined;
  if (targetId && ["push_update", "get_build_logs", "get_ci_results", "check_deploy_status"].includes(tc.name)) {
    if (!ctx.appId) return `Error: no ${config.noun} deployed yet. Deploy first before using ${tc.name}.`;
    if (targetId !== ctx.appId)
      return `Error: you can only ${tc.name} on your own ${config.noun} "${ctx.appId}". No access to "${targetId}".`;
  }

  // Validate deploy ID (id presence already enforced above for deploy).
  if (tc.name === "deploy") {
    const id = tc.input.id as string;
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(id) || id.length > 58 || id.startsWith("free") || id.startsWith("pro")) {
      return `Error: invalid ${config.noun} ID "${id}". Must be lowercase, numbers, hyphens. No "free"/"pro" prefix. Max 58 chars.`;
    }
    if (ctx.appId && ctx.appId !== id) {
      return `Error: this session already deployed "${ctx.appId}". Create a new project for a different ${config.noun}.`;
    }
  }

  // Build-sanity gate: before ANY ship (deploy or update), statically verify the
  // compiled source can build. A broken generation (duplicate top-level block,
  // truncated file, unbalanced braces) otherwise fails CI silently and keeps the
  // old version live. Blocking here turns that into an in-session self-correction.
  if (tc.name === "deploy" || tc.name === "push_update") {
    const findings = checkBuildSanity(ctx.files);
    if (findings.length) {
      ctx.onDeployStatus({ phase: "error", error: `Build check failed: ${findings.map((f) => f.file).join(", ")}` });
      return formatSanityBlock(findings, config.noun);
    }
  }

  switch (tc.name) {
    case "deploy":
      return executeDeploy(tc, ctx);
    case "push_update":
      return executePushUpdate(tc, ctx);
    case "check_deploy_status":
      return checkDeployStatus(targetId!, ctx.env, config);
    case "list_deployed_apps":
    case "list_deployed_games":
      return listDeployed(ctx.env, config);
    case "fetch_url":
      return executeFetchUrl(tc, config);
    case "get_build_logs":
      return getBuildLogs(targetId!, ctx.env, config);
    case "get_ci_results":
      return getCIResults(targetId!, ctx.env, config);
    case "get_audit_results":
      return getAuditResults(targetId!, config);
    default:
      return `Unknown infra tool: ${tc.name}`;
  }
}

async function executeDeploy(tc: ToolCall, ctx: ExecContext): Promise<string> {
  const appId = tc.input.id as string;
  const appName = tc.input.name as string;

  // Uniqueness / deleted-game check. A repo that exists but is ARCHIVED was
  // deleted via delete_game — writes to it 404 ("failed to create blob"),
  // which read as a mystery infra failure (escape, 2026-07-11). Name it.
  const repoRes = await fetch(`https://api.github.com/repos/${ctx.config.org}/${appId}`, {
    headers: {
      Authorization: `Bearer ${ctx.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": ctx.config.agentName,
    },
  });
  if (repoRes.status === 200) {
    const repo = (await repoRes.json()) as { archived?: boolean };
    if (repo.archived) {
      return `Error: the ${ctx.config.noun} "${appId}" was DELETED (its repo is archived), so it can't be redeployed. Start a new ${ctx.config.noun} with a different ID instead.`;
    }
    if (!ctx.appId) {
      return `Error: ${ctx.config.noun} ID "${appId}" is already taken, and this session is not opened on it — deploying would overwrite that ${ctx.config.noun} blind. If it's the user's own ${ctx.config.noun}, tell them to open it first (opening loads the real repo files into this session); do NOT retry deploy or push_update. Otherwise choose a different ID.`;
    }
  }

  // Replace APPNAME placeholders (slug in package manifests, display name
  // elsewhere). For Path B the delta computation re-derives the same baseline,
  // so this must stay the single canonical substitution — hence the shared fn.
  substituteAppName(ctx.files, appId, appName);

  ctx.onAppDeployed(appId, appName);

  let deployError: string | null = null;
  let finalStatus: DeployStatus | null = null;
  await deployApp(
    {
      id: appId,
      name: appName,
      category: tc.input.category as string,
      icon: tc.input.icon as string,
      iconBg: tc.input.iconBg as string,
      description: tc.input.description as string,
      template: ctx.engine,
    },
    ctx.files,
    ctx.env,
    ctx.config,
    (status) => {
      ctx.onDeployStatus(status);
      // Track the LAST status, not just "live". deployApp/deployPathB report a
      // terminal build failure (CI red, compliance reject, R2 sync error) via
      // onStatus({phase:"error"}) and then RETURN NORMALLY — they don't throw. So
      // keying success on "did it throw" reported "Deploy succeeded" for a failed
      // build, and the agent told the user the game was live while it was broken
      // (the silent-failure loop). The tool result must agree with deployStatus.
      finalStatus = status;
    },
    ctx.creatorLogin,
    ctx.seed,
  ).catch((err) => {
    deployError = String(err);
  });

  if (deployError) {
    ctx.onDeployStatus({ phase: "error", error: deployError });
    return `Deploy FAILED: ${deployError}`;
  }
  // TS narrows finalStatus to never inside the closure; read via a widened local.
  const last = finalStatus as DeployStatus | null;
  if (last?.phase === "error") return `Deploy FAILED: ${last.error || "the build did not complete"}. Use get_build_logs to see why, fix the code, then push_update.`;
  if (last?.phase === "live") return `Deploy succeeded. Live: ${last.appUrl}`;
  return `Deploy pushed — CI is still building. Poll check_deploy_status; if it ends in failure, use get_build_logs and push_update a fix.`;
}

async function executePushUpdate(tc: ToolCall, ctx: ExecContext): Promise<string> {
  const id = tc.input.id as string;
  ctx.onDeployStatus({ phase: "pushing", progress: "Pushing update..." });
  const result = await pushUpdate(id, ctx.files, (tc.input.message as string) || "Update", ctx.env, ctx.config);
  if (result.startsWith("Error")) {
    ctx.onDeployStatus({ phase: "error", error: result });
    return result;
  }

  // Wait for the Actions build to finish and resolve to live/error — exactly
  // like the FIRST deploy does (deployPathB → waitForActionsDeploy). Without
  // this, push_update set phase:"building" and returned immediately, so the
  // studio sat on "Building/Deploying…" FOREVER even though CI completed — the
  // "deploy gets stuck for everyone and never finishes" report. Every edit after
  // the first deploy hit this. The poll persists live (or a real error with a
  // logs link) so the user always sees the true outcome.
  const appUrl = `https://${id}.${ctx.config.domain}`;
  ctx.onDeployStatus({ phase: "building", deployUrl: appUrl });
  let outcome: string | null = null;
  await waitForActionsDeploy(id, ctx.env, ctx.config, (s) => {
    ctx.onDeployStatus(s);
    if (s.phase === "live") outcome = `Update deployed and LIVE at ${s.appUrl}.`;
    else if (s.phase === "error") outcome = `Update pushed but the build FAILED: ${s.error}`;
  }, appUrl).catch((err) => {
    outcome = `Update pushed; couldn't confirm the build status: ${String(err)}. Use check_deploy_status.`;
  });
  return outcome || `${result} CI is still building — check_deploy_status for the final result.`;
}

async function executeFetchUrl(tc: ToolCall, config: StoreConfig): Promise<string> {
  const url = tc.input.url as string;
  if (!url.startsWith("https://") || /localhost|127\.|192\.168|10\.|172\.1[6-9]\.|172\.2|172\.3[01]\.|169\.254/i.test(url)) {
    return "Error: can only fetch public HTTPS URLs.";
  }
  return fetchUrl(url, (tc.input.method as string) || "GET", config.agentName);
}
