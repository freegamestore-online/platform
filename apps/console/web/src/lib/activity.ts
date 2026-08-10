import type { DeployState } from "../types";

export type ActivityTone = "idle" | "busy" | "ok" | "error";

export interface Activity {
  /** Short, obvious label: what the studio is doing right now. */
  label: string;
  /** Optional one-line elaboration. */
  detail?: string;
  tone: ActivityTone;
  /** Whether to show a spinner (work in progress). */
  busy: boolean;
}

interface MinimalMessage {
  role: string;
  content: string;
}

/**
 * Collapse the studio's various signals (agent streaming + deploy pipeline
 * phase + the last tool it ran) into ONE clear "what's happening now" status,
 * so the UI can always say whether it's coding, building, or deploying.
 *
 * Precedence:
 *   1. An active deploy pipeline (provisioning/pushing/building) — the most
 *      concrete state, wins even over streaming.
 *   2. The agent streaming — coding / checking compliance / deploying, refined
 *      by the last tool it invoked. Wins over a stale terminal phase because a
 *      new turn is underway.
 *   3. A terminal deploy phase (live / error) when nothing else is running.
 *   4. Idle.
 */
export function deriveActivity(
  isStreaming: boolean,
  deployState: DeployState | null,
  messages: MinimalMessage[],
): Activity {
  const phase = deployState?.phase;

  if (phase === "provisioning") {
    return { label: "Provisioning", detail: "Creating your game's repo & hosting", tone: "busy", busy: true };
  }
  if (phase === "pushing") {
    return { label: "Pushing code", detail: "Uploading your game to GitHub", tone: "busy", busy: true };
  }
  if (phase === "building") {
    return { label: "Building & deploying", detail: deployState?.hint ?? "GitHub Actions is building and shipping to R2", tone: "busy", busy: true };
  }

  if (isStreaming) {
    const lastTool = [...messages].reverse().find((m) => m.role === "tool")?.content ?? "";
    if (/compliance/i.test(lastTool)) {
      return { label: "Checking compliance", detail: "Validating against platform rules", tone: "busy", busy: true };
    }
    if (/^(deploy|pushing|push_update|provision)/i.test(lastTool)) {
      return { label: "Deploying", detail: "Shipping your game live", tone: "busy", busy: true };
    }
    if (/^(writing|reading|editing|creating)\b/i.test(lastTool)) {
      return { label: "Writing code", detail: lastTool, tone: "busy", busy: true };
    }
    return { label: "Coding", detail: "The agent is building your game", tone: "busy", busy: true };
  }

  if (phase === "live") {
    return { label: "Live", detail: "Your game is deployed", tone: "ok", busy: false };
  }
  if (phase === "error") {
    return { label: "Deploy failed", detail: deployState?.error, tone: "error", busy: false };
  }

  return { label: "Ready", detail: "Describe a change to start building", tone: "idle", busy: false };
}
