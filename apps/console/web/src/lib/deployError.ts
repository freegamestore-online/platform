import type { DeployState } from "../types";

/** The org every FGS game repo lives in (same hardcoded assumption as the
 *  `<id>.freegamestore.online` preview URL in Create.tsx). */
const ORG = "freegamestore-online";

/**
 * The prompt the "Fix & retry" button sends. A bare re-deploy of unchanged code
 * fails CI identically, so the retry has to ask the agent to DIAGNOSE first —
 * it has get_build_logs / get_ci_results for exactly this.
 */
export const RETRY_DEPLOY_PROMPT = "The deploy failed. Check the build logs, fix the problem, then deploy again.";

export interface DeployErrorInfo {
  /** Always non-empty — the real error, or an actionable fallback. */
  message: string;
  /** False when the server sent no detail and `message` is the fallback. */
  hasDetail: boolean;
  /** The repo's Actions tab, when the game id is known. */
  actionsUrl: string | null;
}

/**
 * One place that decides what a creator is told about a failed deploy, so the
 * chat-column notice and the desktop DeployLog panel can never drift apart.
 *
 * `{ phase: "error", error: "" }` is a real case (the server's error event can
 * carry an empty string), and "Deploy failed" alone leaves the creator with
 * nowhere to go — so the fallback names the next step instead.
 */
export function deployErrorInfo(state: DeployState | null, appId?: string | null): DeployErrorInfo {
  const detail = state?.error?.trim();
  const actionsUrl = appId ? `https://github.com/${ORG}/${appId}/actions` : null;
  if (detail) return { message: detail, hasDetail: true, actionsUrl };
  return {
    message: actionsUrl
      ? "The build failed but didn't report a reason. Open the Actions tab for this game to see which step failed."
      : "The build failed but didn't report a reason. Check the game's GitHub Actions logs to see which step failed.",
    hasDetail: false,
    actionsUrl,
  };
}
