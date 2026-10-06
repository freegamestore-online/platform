/** Infra round: drift guard, pivot guard, rate limit, and deploy execution.
 *  Extracted from executeTurn to keep session.ts manageable and testable. */

import type { StoreConfig } from "./config";
import type { DeployEnv, DeployStatus } from "./deploy";
import { fetchRepoHeadSha } from "./deploy";
import { reportPlatformError } from "./errlog";
import type { Env } from "./index";
import { executeInfraTool } from "./infra-exec";
import { allowDeploy } from "./ratelimit";
import { activityFromDeployStatus } from "./sessions";
import { clampToolResultForHistory } from "./tools";
import type { Message } from "./providers/types";
import type { TurnFence } from "./watchdog";

export interface InfraRoundResult {
  hasInfraRequests: boolean;
  successfulDeploy: boolean;
}

export interface InfraRoundDeps {
  session: {
    appId: string | null;
    appName: string | null;
    deployStatus: DeployStatus | null;
    deployed?: boolean;
    deletedFiles?: string[];
    pivotAttempted?: boolean;
    lastPushedSha?: string;
    importedSha?: string;
  };
  files: Map<string, string>;
  deletedFiles: Set<string>;
  deployEnv: DeployEnv;
  config: StoreConfig;
  env: Env;
  userId: string | null;
  sessionId: string | null;
  creatorLogin?: string;
  seed?: Record<string, string>;
  engine?: string;
  infraRequests: Array<{ id: string; toolCall: any }>;
  newMessages: Message[];
  /** Turn fence that guards against superseded turns */
  fence: TurnFence;
  sendSSE: (evt: { type: string; data: string }) => void;
  setActivity: (activity: {
    phase: "idle" | "writing" | "provisioning" | "pushing" | "building" | "live" | "error";
    detail?: string | null;
  }) => void;
  logError: (source: string, message: string) => void;
  logDeploy: (status: DeployStatus) => void;
  appendAssistantError: (source: string, message: string) => void;
  sendPush: (message: string) => void;
  persistNow: () => Promise<void>;
}

/** Execute all infra tools in this round: drift/pivot/rate-limit guards, then
 *  tool execution, then result merging and failure classification. Returns true
 *  if a deploy succeeded (turn is terminal); false if we should loop to feed
 *  results back to the provider. */
export async function executeInfraRound(deps: InfraRoundDeps): Promise<InfraRoundResult> {
  const {
    session,
    files,
    deletedFiles,
    deployEnv,
    config,
    env,
    userId,
    sessionId,
    creatorLogin,
    seed,
    engine,
    infraRequests,
    newMessages,
    fence,
    sendSSE,
    setActivity,
    logError,
    logDeploy,
    appendAssistantError,
    sendPush,
    persistNow,
  } = deps;

  const infraResults: { id: string; content: string }[] = [];

  for (const req of infraRequests) {
    // A superseded turn must not deploy or push over the replacement.
    if (!fence.isCurrent()) return { hasInfraRequests: false, successfulDeploy: false };

    const tc = req.toolCall;
    let toolResult: string;

    // Drift guard: if the repo moved OUTSIDE this session since it last
    // synced (a direct fix, another session, git), pushing session
    // files would silently overwrite that work.
    if (tc.name === "push_update" && session.appId) {
      const known = session.lastPushedSha || session.importedSha;
      if (known) {
        const head = await fetchRepoHeadSha(session.appId, deployEnv.GITHUB_TOKEN, config).catch(() => null);
        if (head && head !== known) {
          toolResult = `Error: the ${config.noun}'s code was changed OUTSIDE this chat since it last synced (a direct edit or another session). Pushing now would overwrite those changes. Tell the user to RE-OPEN this ${config.noun} from My Games (which re-syncs the files) and then re-apply the change.`;
          logError(
            "drift",
            `push_update blocked: repo HEAD ${head?.slice(0, 7)} != session ${known.slice(0, 7)} for ${session.appId}`,
          );
          sendSSE({ type: "tool_result", data: JSON.stringify({ id: tc.id, tool: tc.name, result: toolResult }) });
          infraResults.push({ id: tc.id, content: toolResult });
          continue;
        }
      }
    }

    // Pivot guard: a chat is bound to ONE game. Once the agent tries to `deploy`
    // a DIFFERENT game id, refuse push_update for the rest of the turn.
    if (tc.name === "deploy" && session.appId) {
      const wantId = typeof tc.input.id === "string" ? tc.input.id.trim() : "";
      session.pivotAttempted = wantId !== "" && wantId !== session.appId;
    }
    if (tc.name === "push_update" && session.pivotAttempted) {
      const label = session.appName || session.appId;
      toolResult = `Error: this chat builds "${label}" — you just tried to deploy a DIFFERENT ${config.noun}, so push_update now would OVERWRITE "${session.appId}" with it. Do NOT push_update. Tell the user this chat is tied to "${label}", and that to build a different ${config.noun} they must start a new one with the "New ${config.Noun}" button (it opens a fresh chat).`;
      logError("pivot", `push_update blocked: session bound to ${session.appId} after a different-game deploy attempt`);
      sendSSE({ type: "tool_result", data: JSON.stringify({ id: tc.id, tool: tc.name, result: toolResult }) });
      infraResults.push({ id: tc.id, content: toolResult });
      continue;
    }

    // Deploy rate limit
    const spendsSharedToken = tc.name === "deploy" || tc.name === "push_update";
    if (spendsSharedToken && userId && !(await allowDeploy(deps as any, userId, Math.floor(Date.now() / 1000)))) {
      toolResult = `Error: you've hit the deploy limit (30/hour). Wait a bit before deploying again.`;
      logError("ratelimit", `deploy rate limit hit for ${userId}`);
      sendSSE({ type: "tool_result", data: JSON.stringify({ id: tc.id, tool: tc.name, result: toolResult }) });
      infraResults.push({ id: tc.id, content: toolResult });
      continue;
    }

    // Execute the infra tool
    try {
      toolResult = await executeInfraTool(tc, {
        appId: session.appId,
        files,
        deletedFiles,
        env: deployEnv,
        config,
        creatorLogin,
        seed,
        engine,
        onDeployStatus: fence.guard((status: DeployStatus) => {
          session.deployStatus = status;
          setActivity(activityFromDeployStatus(status));
          logDeploy(status);
          persistNow().catch((e) => logError("deploy", `persist status: ${String(e)}`));
          sendSSE({ type: "deploy_status", data: JSON.stringify(status) });
          
          // Record the repo HEAD this push produced — the drift guard's reference
          if ((status.phase === "live" || status.phase === "error") && session.appId) {
            fetchRepoHeadSha(session.appId, deployEnv.GITHUB_TOKEN, config)
              .then((sha) => {
                if (sha && session) {
                  session.lastPushedSha = sha;
                  persistNow().catch(() => {});
                }
              })
              .catch(() => {});
          }
          
          if (status.phase === "live") {
            sendPush("Your build is live!");
          } else if (status.phase === "error") {
            appendAssistantError("deploy", status.error);
            sendPush("Build failed");
            // Durable, centrally-discoverable record of the failure (#21).
            // Without this a deploy failure existed only in this DO's
            // errors[] array and Workers Logs, so the admin Errors view,
            // Ops panel and Overview counts all read ZERO during a wave of
            // failures — and triage required already knowing the session
            // id. Fire-and-forget: reporting a failure must never become a
            // second failure, and must not delay the user's error.
            reportPlatformError(env, config.domain, {
              source: "agent/deploy",
              user: userId || null,
              context: `gameId=${session.appId ?? "?"} sessionId=${sessionId}`,
              message: status.error,
            }).catch(() => {});
            persistNow().catch((e) => logError("deploy", `persist error: ${String(e)}`));
          }
        }),
        onAppBound: fence.guard((id: string, name: string) => {
          session.appId = id;
          session.appName = name;
          session.deployStatus = { phase: "provisioning", steps: [] };
          setActivity({ phase: "provisioning", detail: "Provisioning" });
          persistNow().catch((e) => logError("deploy", `persist provision: ${String(e)}`));
        }),
        onAppDeployed: fence.guard(() => {
          session.deployed = true;
          persistNow().catch((e) => logError("deploy", `persist deployed: ${String(e)}`));
        }),
      });
    } catch (err) {
      toolResult = `Tool ${tc.name} threw an error: ${String(err)}`;
      logError("infra", toolResult);
    }

    sendSSE({ type: "tool_result", data: JSON.stringify({ id: tc.id, tool: tc.name, result: toolResult.slice(0, 500) }) });
    infraResults.push({ id: tc.id, content: clampToolResultForHistory(tc.name, toolResult) });
  }

  // Merge infra results with any pending tool_result message
  const lastMsg = newMessages[newMessages.length - 1];
  if (lastMsg?.role === "tool_result" && lastMsg.toolResults) {
    lastMsg.toolResults.push(...infraResults);
  } else {
    newMessages.push({ role: "tool_result", content: "", toolResults: infraResults, ts: Date.now() });
  }

  if (!fence.isCurrent()) return { hasInfraRequests: false, successfulDeploy: false };

  // Classify the outcome: did we get a successful deploy/push?
  const hadDeploy = infraRequests.some((r) => r.toolCall.name === "deploy" || r.toolCall.name === "push_update");
  const failedResult = (c: string) =>
    c.startsWith("Error") || c.includes("Deploy FAILED:") || c.includes("Update pushed but the build FAILED:");
  const deployFailed = hadDeploy && (session.deployStatus?.phase === "error" || infraResults.some((r) => failedResult(r.content)));

  return { hasInfraRequests: true, successfulDeploy: hadDeploy && !deployFailed };
}
