import { useState, useCallback, useRef } from "react";
import { useProjects, type Project } from "./useProjects";

export type { Project };

const AGENT_URL = "https://agent.freegamestore.online";
const DEFAULT_MESSAGES: AgentMessage[] = [{ role: "system", content: "Describe the game you want to build." }];

/** A single message in the agent conversation (user, assistant, tool, or system). */
export interface AgentMessage {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
}

export type { DeployState } from "../types";
import type { DeployState } from "../types";

/** Configuration for the AI provider. The API key is NO LONGER sent from the
 *  browser — it lives in the agent's encrypted server-side vault and is resolved
 *  per-request there. `apiKey` remains optional only for legacy callers. */
export interface AIConfig {
  provider: string;
  model: string;
  apiKey?: string;
  temperature: number;
  maxTokens: number;
}

/** Manages the VibeCode agent session — chat messages, streaming, deploy state, and project switching. */
export function useAgent() {
  const projectsMgr = useProjects();
  const sessionId = projectsMgr.currentId;
  const [messages, setMessages] = useState<AgentMessage[]>(DEFAULT_MESSAGES);
  // Chat pagination. A refreshed session restores its FULL transcript from the
  // DO, but we only render the last INITIAL_VISIBLE bubbles; "show earlier"
  // reveals PAGE more at a time (scrolling up). Keeps a long build history from
  // dumping hundreds of bubbles at once while never losing any.
  const INITIAL_VISIBLE = 20;
  const PAGE = 10;
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  const showEarlier = useCallback(() => setVisibleCount((c) => c + PAGE), []);
  const [isStreaming, setIsStreaming] = useState(false);
  const [tokensIn, setTokensIn] = useState(0);
  const [tokensOut, setTokensOut] = useState(0);
  const [deployState, setDeployState] = useState<DeployState | null>(null);
  // Sticky error banner. Chat/deploy errors used to live only as a chat bubble,
  // so any session reset (e.g. the jump to a fresh "New Game") wiped them and
  // the user never saw what failed. This survives loadHistory/auto-reset and is
  // cleared only on an explicit new send, a project switch, or manual dismiss.
  const [error, setError] = useState<string | null>(null);
  const isStreamingRef = useRef(isStreaming);
  isStreamingRef.current = isStreaming;
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  // No client-side message persistence: the agent worker's Durable Object saves
  // the authoritative transcript on every turn, and loadHistory() restores it
  // from /session/:id/history. Mirroring messages into a separate publisher
  // store only forked the transcript and raced the DO.

  const resetUI = useCallback(() => {
    setMessages(DEFAULT_MESSAGES);
    setVisibleCount(INITIAL_VISIBLE);
    setDeployState(null);
    setTokensIn(0);
    setTokensOut(0);
    setError(null);
  }, []);

  // Switching sessions mid-stream is unsafe: resetUI() clears messages and
  // loadHistory() refuses to run while streaming, so the still-open SSE reader
  // would append the old turn's deltas onto the new session's blank view (and
  // leave the composer stuck). Block session changes until the stream ends; the
  // UI also disables these controls for feedback.
  const createProject = useCallback((name: string, appId?: string) => {
    if (isStreamingRef.current) return projectsMgr.currentId ?? "";
    const id = projectsMgr.create(name, appId);
    resetUI();
    return id;
  }, [projectsMgr, resetUI]);

  const switchProject = useCallback((id: string) => {
    if (isStreamingRef.current) return;
    projectsMgr.switchTo(id);
    resetUI();
  }, [projectsMgr, resetUI]);

  // Open an existing game in the studio (import its files if not already local).
  // Surfaces any failure on the sticky error banner instead of silently no-op'ing.
  const openGame = useCallback(async (gameId: string): Promise<string | null> => {
    if (isStreamingRef.current) return null;
    try {
      const id = await projectsMgr.openGame(gameId);
      resetUI();
      return id;
    } catch (e) {
      setError((e as Error).message || `Couldn't open ${gameId}.`);
      return null;
    }
  }, [projectsMgr, resetUI]);

  const loadHistory = useCallback(async () => {
    if (!sessionId) {
      setMessages(DEFAULT_MESSAGES);
      setDeployState(null);
      return;
    }
    if (isStreamingRef.current) return;
    try {
      const historyRes = await fetch(`${AGENT_URL}/session/${sessionId}/history`, { credentials: "include" });
      // Bail if the user switched projects while this was in flight, so the old
      // session's history can't overwrite the newly-selected one.
      if (sessionIdRef.current !== sessionId) return;
      if (historyRes.ok) {
        const historyData = await historyRes.json();
        if (sessionIdRef.current !== sessionId) return;
        const restored = restoreMessages(historyData.messages || []);
        if (restored.length > 0) {
          setMessages(restored);
          setVisibleCount(INITIAL_VISIBLE); // show the last 20 on restore
          setDeployState(historyData.deployStatus ?? null);
          // Restore the running token totals too — /history reports them, but
          // they weren't being read, so a reloaded session always showed
          // "In 0 · Out 0" even after a long build.
          if (historyData.tokenUsage) {
            setTokensIn(historyData.tokenUsage.input ?? 0);
            setTokensOut(historyData.tokenUsage.output ?? 0);
          }
          if (historyData.deployStatus?.phase === "live" && historyData.appId) {
            projectsMgr.markDeployed(sessionId, historyData.appId, historyData.deployStatus.appUrl || "");
          } else if (historyData.appName) {
            projectsMgr.rename(sessionId, historyData.appName);
          }
        }
      }
    } catch {
      // The composer remains usable; the next focus/reload can retry history.
    }
  }, [sessionId, projectsMgr.markDeployed, projectsMgr.rename]);

  // After the SSE stream drops mid-deploy, the game's GitHub Actions build keeps
  // running (it's independent of the connection). Poll the session status so a
  // successful deploy resolves to "live" instead of a scary "unknown" — the DO
  // writes deployStatus as the build finishes.
  const pollDeployStatus = useCallback(async (sid: string, deployUrl?: string) => {
    for (let i = 0; i < 18; i++) { // ~3 min at 10s
      await new Promise((r) => setTimeout(r, 10000));
      if (sessionIdRef.current !== sid) return; // user switched projects
      try {
        const res = await fetch(`${AGENT_URL}/session/${sid}/status`, { credentials: "include" });
        if (!res.ok) continue;
        const ds = ((await res.json()) as { deployStatus?: DeployState | null }).deployStatus;
        if (ds?.phase === "live") { setDeployState(ds); setError(null); return; }
        if (ds?.phase === "error") { setDeployState(ds); setError(ds.error || "Deploy failed."); return; }
      } catch { /* keep polling */ }
    }
    // Polling gave up, but the build is almost certainly still running — this is
    // NOT an error. Keep the deploy state in "building" with a hint so the UI
    // shows a calm "Building & deploying" status, not a red error banner.
    const where = deployUrl ? ` at ${deployUrl.replace("https://", "")}` : "";
    setDeployState((prev) => ({
      phase: "building",
      steps: prev?.steps ?? [],
      appUrl: deployUrl ?? prev?.appUrl,
      hint: `Still building${where} — this can take a minute or two. It flips to Live automatically, or reload to check.`,
    }));
  }, []);

  const sendMessage = useCallback(async (message: string, aiConfig: AIConfig) => {
    if (!sessionId || isStreaming) return;
    const streamSession = sessionId;
    setIsStreaming(true);
    setError(null);
    setMessages((prev) => [...prev, { role: "user", content: message }, { role: "assistant", content: "" }]);
    let assistantText = "";
    // When a tool interrupts the assistant's prose, the next text delta must
    // open a NEW assistant bubble *below* the tool line. Otherwise post-tool
    // prose is glued onto the pre-tool bubble and renders above the tool
    // activity — wrong order on every multi-tool (i.e. every real build) turn.
    let pendingNewAssistant = false;

    // Update the LAST assistant message in the array
    const updateAssistant = (content: string) => {
      setMessages((prev) => {
        const updated = [...prev];
        for (let i = updated.length - 1; i >= 0; i--) {
          if (updated[i]?.role === "assistant") {
            updated[i] = { role: "assistant", content };
            break;
          }
        }
        return updated;
      });
    };

    // Append streamed assistant text, starting a fresh bubble after a tool.
    const appendAssistant = (delta: string) => {
      if (pendingNewAssistant) {
        pendingNewAssistant = false;
        assistantText = "";
        setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
      }
      assistantText += delta;
      updateAssistant(assistantText);
    };

    try {
      const chatRes = await fetch(`${AGENT_URL}/session/${sessionId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ message, aiConfig }),
      });
      if (!chatRes.ok) {
        const detail = (await chatRes.text().catch(() => "")) || `Request failed (${chatRes.status})`;
        updateAssistant(`Error: ${detail}`);
        setError(detail);
        return;
      }

      const reader = chatRes.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          let evt;
          try { evt = JSON.parse(line.slice(6).trim()); } catch { continue; }

          // Defense-in-depth: if the session changed out from under this stream,
          // stop applying its events to the (now different) visible transcript.
          if (sessionIdRef.current !== streamSession) continue;

          // A malformed nested payload on one event must not throw out of the
          // read loop (which would truncate the whole turn as a "connection
          // error"). Isolate each event.
          try {
            switch (evt.type) {
              case "text":
                appendAssistant(evt.data);
                break;
              case "tool_call": {
                const tc = JSON.parse(evt.data);
                setMessages((prev) => [...prev, { role: "tool", content: toolLabel(tc) }]);
                // The AI names the game in its deploy call — reflect that in the
                // project picker immediately, so a session stops showing
                // "New Game" in the dropdown without waiting for a reload.
                const named = tc?.input?.name;
                if (tc?.name === "deploy" && typeof named === "string" && named.trim() && sessionId) {
                  projectsMgr.rename(sessionId, named.trim());
                }
                pendingNewAssistant = true;
                break;
              }
              case "tool_result": {
                const tr = JSON.parse(evt.data);
                if (tr.tool === "deploy") setDeployState({ phase: "provisioning", steps: [] });
                else if (!["write_file", "read_file", "list_files", "delete_file"].includes(tr.tool) && tr.result) {
                  setMessages((prev) => [...prev, { role: "tool", content: `${tr.tool}:\n${tr.result.slice(0, 400)}` }]);
                  pendingNewAssistant = true;
                }
                break;
              }
              case "usage": {
                const u = JSON.parse(evt.data);
                if (u.input) setTokensIn((p) => p + u.input);
                if (u.output) setTokensOut((p) => p + u.output);
                break;
              }
              case "deploy_status": {
                const ds = JSON.parse(evt.data);
                // The server's error event carries only { phase, error } — no
                // steps and no indication of which step failed. Preserve the
                // in-progress steps/phase so DeployLog can highlight the failure.
                setDeployState((prev) =>
                  ds.phase === "error" && prev
                    ? { ...ds, steps: ds.steps ?? prev.steps, failedPhase: prev.phase }
                    : ds,
                );
                if (ds.phase === "error") setError(ds.error || "Deploy failed");
                if (ds.phase === "live" && ds.appUrl && sessionId) {
                  const host = ds.appUrl.replace("https://", "").split("/")[0].split(".")[0];
                  projectsMgr.markDeployed(sessionId, host, ds.appUrl);
                }
                break;
              }
              case "error":
                appendAssistant(`\nError: ${evt.data}`);
                setError(String(evt.data));
                break;
            }
          } catch { /* skip a single malformed event, keep the stream alive */ }
        }
      }
      if (!assistantText) updateAssistant("(No response)");
    } catch (err) {
      const errMsg = (err as Error).message || String(err);
      if (errMsg.includes("reset") || errMsg.includes("network") || errMsg.includes("Failed to fetch")) {
        updateAssistant(`${assistantText}\n\nConnection interrupted. Say "continue" or "deploy" to resume.`);
        setError(`Connection interrupted: ${errMsg}. Say "continue" or "deploy" to resume.`);
      } else {
        updateAssistant(`Connection error: ${errMsg}`);
        setError(`Connection error: ${errMsg}`);
      }
    } finally {
      setIsStreaming(false);
      // If the stream ended (cleanly or by a dropped connection) while a deploy
      // was still provisioning/pushing/building — with no terminal live/error
      // deploy_status — don't leave the spinner stuck forever. Resolve it to a
      // recoverable error state. Terminal phases (live/error) are left as-is.
      setDeployState((prev) => {
        if (prev && prev.phase !== "live" && prev.phase !== "error") {
          // Don't declare failure — the Actions build finishes independent of
          // this stream. Keep the in-progress view and poll status; the poll
          // resolves it to live/error or a friendly "still building" note.
          // DeployState exposes appUrl (not deployUrl) — reading the wrong field
          // meant the "still building at <url>" hint always lost its link.
          const deployUrl = prev.appUrl;
          if (sessionId) void pollDeployStatus(sessionId, deployUrl);
          return prev;
        }
        return prev;
      });
    }
  }, [sessionId, isStreaming, projectsMgr, pollDeployStatus]);

  const dismissError = useCallback(() => setError(null), []);

  return {
    messages, visibleCount, showEarlier, isStreaming, tokensIn, tokensOut, deployState, error, dismissError,
    projects: projectsMgr.projects, currentProjectId: projectsMgr.currentId,
    projectsError: projectsMgr.loadError, projectsLoading: projectsMgr.loading, reloadProjects: projectsMgr.reload,
    sendMessage, createProject, switchProject, openGame, loadHistory,
    deleteProject: projectsMgr.deleteProject,
  };
}

// -- Helpers --

function toolLabel(tc: { name: string; input?: Record<string, unknown> }): string {
  const i = tc.input || {};
  switch (tc.name) {
    case "deploy": return `Deploying: ${i.name || i.id || "game"}...`;
    case "push_update": return `Pushing update to ${i.id}...`;
    case "write_file": return `Writing ${i.path || "file"}`;
    case "read_file": return `Reading ${i.path || "file"}`;
    case "run_compliance_check": return "Running compliance checks...";
    case "search_files": return `Searching for "${i.pattern}"`;
    default: return tc.name;
  }
}

interface ServerMessage {
  role: string;
  content?: string;
  toolCalls?: Array<{ name: string; input?: Record<string, unknown> }>;
  toolResults?: Array<{ content: string }>;
}

function restoreMessages(serverMessages: ServerMessage[]): AgentMessage[] {
  const restored: AgentMessage[] = [];
  for (const m of serverMessages) {
    if (m.role === "assistant") {
      if (m.content) restored.push({ role: "assistant", content: m.content });
      for (const tc of m.toolCalls || []) restored.push({ role: "tool", content: toolLabel(tc) });
    } else if (m.role === "tool_result") {
      for (const tr of m.toolResults || []) {
        if (tr.content?.length > 20) restored.push({ role: "tool", content: tr.content.slice(0, 400) });
      }
    } else if (m.role === "user") {
      restored.push({ role: "user", content: m.content ?? "" });
    }
  }
  return restored;
}
