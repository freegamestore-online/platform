/** Execute infra tools server-side. Extracted from session.ts to keep it manageable. */

import type { ToolCall } from "./providers/types";
import type { DeployEnv, DeployStatus } from "./deploy";
import { deployApp, pushUpdate } from "./deploy";
import { checkDeployStatus, listDeployedApps, fetchUrl, getBuildLogs, getCIResults, getAuditResults } from "./infra";

interface ExecContext {
  appId: string | null;
  files: Map<string, string>;
  env: DeployEnv;
  onDeployStatus: (status: DeployStatus) => void;
  onAppDeployed: (id: string, name: string) => void;
}

/** Execute a single infra tool. Returns the result string. */
export async function executeInfraTool(tc: ToolCall, ctx: ExecContext): Promise<string> {
  // Authorization: scope write tools to the session's own game
  const targetId = tc.input.id as string | undefined;
  if (targetId && ["push_update", "get_build_logs", "get_ci_results", "check_deploy_status"].includes(tc.name)) {
    if (!ctx.appId) return `Error: no game deployed yet. Deploy first before using ${tc.name}.`;
    if (targetId !== ctx.appId) return `Error: you can only ${tc.name} on your own game "${ctx.appId}". No access to "${targetId}".`;
  }

  // Validate deploy game ID
  if (tc.name === "deploy" && tc.input.id) {
    const id = tc.input.id as string;
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(id) || id.length > 58 || id.startsWith("free") || id.startsWith("pro")) {
      return `Error: invalid game ID "${id}". Must be lowercase, numbers, hyphens. No "free"/"pro" prefix. Max 58 chars.`;
    }
    if (ctx.appId && ctx.appId !== id) {
      return `Error: this session already deployed "${ctx.appId}". Create a new project for a different game.`;
    }
  }

  switch (tc.name) {
    case "deploy": return executeDeploy(tc, ctx);
    case "push_update": return executePushUpdate(tc, ctx);
    case "check_deploy_status": return checkDeployStatus(targetId!, ctx.env);
    case "list_deployed_games": return listDeployedApps(ctx.env);
    case "fetch_url": return executeFetchUrl(tc);
    case "get_build_logs": return getBuildLogs(targetId!, ctx.env);
    case "get_ci_results": return getCIResults(targetId!, ctx.env);
    case "get_audit_results": return getAuditResults(targetId!);
    default: return `Unknown infra tool: ${tc.name}`;
  }
}

async function executeDeploy(tc: ToolCall, ctx: ExecContext): Promise<string> {
  const appId = tc.input.id as string;
  const appName = tc.input.name as string;

  // Replace APPNAME placeholders
  for (const [path, content] of ctx.files) {
    if (content.includes("APPNAME")) {
      const replaced = path.includes("package.json") ? content.replace(/APPNAME/g, appId) : content.replace(/APPNAME/g, appName);
      ctx.files.set(path, replaced);
    }
  }

  ctx.onAppDeployed(appId, appName);

  let deployError: string | null = null;
  await deployApp(
    {
      id: appId,
      name: appName,
      category: tc.input.category as string,
      icon: tc.input.icon as string,
      iconBg: tc.input.iconBg as string,
      description: tc.input.description as string,
    },
    ctx.files,
    ctx.env,
    ctx.onDeployStatus,
  ).catch((err) => { deployError = String(err); });

  if (deployError) {
    ctx.onDeployStatus({ phase: "error", error: deployError });
    return `Deploy FAILED: ${deployError}`;
  }
  return `Deploy succeeded. Preview URL will appear in the deploy status.`;
}

async function executePushUpdate(tc: ToolCall, ctx: ExecContext): Promise<string> {
  ctx.onDeployStatus({ phase: "pushing", progress: "Pushing update..." });
  const result = await pushUpdate(tc.input.id as string, ctx.files, tc.input.message as string || "Update", ctx.env);
  if (!result.startsWith("Error")) {
    ctx.onDeployStatus({ phase: "building", deployUrl: `Pushing update...` });
  }
  return result;
}

async function executeFetchUrl(tc: ToolCall): Promise<string> {
  const url = tc.input.url as string;
  if (!url.startsWith("https://") || /localhost|127\.|192\.168|10\.|172\.1[6-9]\.|172\.2|172\.3[01]\.|169\.254/i.test(url)) {
    return "Error: can only fetch public HTTPS URLs.";
  }
  return fetchUrl(url, (tc.input.method as string) || "GET");
}
