/** Agent loop: send messages to AI, handle tool calls, repeat until done. */

import type { StoreConfig } from "./config";
import { AnthropicAdapter } from "./providers/anthropic";
import { GitHubModelsAdapter } from "./providers/github";
import { GoogleAdapter } from "./providers/google";
import { OpenAIAdapter } from "./providers/openai";
import type { AIConfig, Message, ProviderAdapter, StreamEvent, TokenUsage, ToolCall, ToolResult } from "./providers/types";
import { getSystemPrompt } from "./template";
import { executeTool, getToolDefinitions, INFRA_TOOLS } from "./tools";

/**
 * Stable signature for a tool call (name + path + a cheap content hash), used by
 * the loop circuit-breaker to detect an EXACT repeat. Hashing the input keeps the
 * dedup map from retaining large file bodies. Exported for unit testing.
 */
export function toolSignature(tc: ToolCall): string {
  const input = (tc.input ?? {}) as Record<string, unknown>;
  const path = typeof input.path === "string" ? input.path : "";
  const raw = JSON.stringify(input);
  let h = 5381;
  for (let i = 0; i < raw.length; i++) h = (((h << 5) + h) ^ raw.charCodeAt(i)) | 0;
  return `${tc.name}:${path}:${h >>> 0}`;
}

function createAdapter(config: AIConfig): ProviderAdapter {
  const temp = config.temperature ?? 0.7;
  const maxTok = config.maxTokens ?? 16384;
  switch (config.provider) {
    case "anthropic":
      return new AnthropicAdapter(config.apiKey, config.model, temp, maxTok);
    case "openai":
      return new OpenAIAdapter(config.apiKey, config.model, undefined, temp, maxTok);
    case "google":
      return new GoogleAdapter(config.apiKey, config.model, temp, maxTok);
    case "github":
      return new GitHubModelsAdapter(config.apiKey, config.model, temp, maxTok);
    default:
      // config originates from the request/stored config, so an unknown
      // provider can slip past the type. Fail loudly instead of returning
      // undefined and crashing later with "cannot read 'run' of undefined".
      throw new Error(`Unknown AI provider: ${config.provider}`);
  }
}

export interface InfraRequest {
  toolCall: ToolCall;
}

export interface AgentTurnResult {
  newMessages: Message[];
  /** Infra tool calls that need server-side execution by the session */
  infraRequests: InfraRequest[];
  /** Token counts summed across every provider round in this turn */
  tokenUsage: TokenUsage;
}

export interface SessionContext {
  appId: string | null;
  appName: string | null;
  fileCount: number;
  fileList: string;
}

/**
 * Run one user turn through the agent loop.
 * Streams events via the writer, handles file tool calls internally.
 * Infra tools (deploy, push_update, etc.) are collected and returned
 * for the session to execute with env access.
 */
export async function runAgentTurn(
  config: AIConfig,
  conversationHistory: Message[],
  userMessage: string,
  files: Map<string, string>,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  storeConfig: StoreConfig,
  ctx?: SessionContext,
  /** Persist the transcript-so-far to durable storage as EACH message is
   *  produced, not only when the whole turn returns. Without this, a reply
   *  streamed live but interrupted before end-of-turn (DO eviction, watchdog,
   *  waitUntil grace expiring) was never saved — reload/other-browser saw the
   *  user's messages with no agent replies. Called with the running newMessages;
   *  the session persists best-effort (fire-and-forget). */
  onCheckpoint?: (newMessages: Message[]) => void,
): Promise<AgentTurnResult> {
  const encoder = new TextEncoder();
  const adapter = createAdapter(config);
  const MAX_LOOPS = 25;
  const toolDefinitions = getToolDefinitions(storeConfig);

  // Build dynamic system prompt with session context
  let systemPrompt = getSystemPrompt(storeConfig);
  if (ctx) {
    const noun = storeConfig.noun;
    const Noun = storeConfig.Noun;
    const parts: string[] = [`\n\n## Current Session State`];
    parts.push(`- Files in project: ${ctx.fileCount} (${ctx.fileList.slice(0, 300)})`);
    if (ctx.appId) {
      parts.push(`- Deployed ${noun} ID: ${ctx.appId}`);
      parts.push(`- ${Noun} name: ${ctx.appName}`);
      parts.push(`- ${Noun} ID: ${ctx.appId} (deployed)`);
      parts.push(`- Use push_update (not deploy) for changes to this ${noun}.`);
    } else {
      parts.push(`- ${Noun} not yet deployed. Use deploy tool when ready.`);
    }
    systemPrompt += parts.join("\n");
  }

  // Trim conversation history to fit model context limits.
  // GitHub Models free tier limits vary by model:
  //   gpt-4.1: 8K tokens, gpt-4o/4o-mini: 16K+, others: varies
  // System prompt + 14 tools ≈ 2600 tokens.
  const isSmallContext = config.provider === "github" && config.model.includes("gpt-4.1");
  const MAX_HISTORY_CHARS = isSmallContext ? 6000 : config.provider === "github" ? 30000 : 80000;

  function msgSize(m: Message): number {
    let size = m.content?.length || 0;
    if (m.toolCalls) size += JSON.stringify(m.toolCalls).length;
    if (m.toolResults) size += JSON.stringify(m.toolResults).length;
    return size;
  }

  const trimmedHistory = [...conversationHistory];
  let historyChars = trimmedHistory.reduce((sum, m) => sum + msgSize(m), 0);

  // Drop messages from the front until under limit
  while (historyChars > MAX_HISTORY_CHARS && trimmedHistory.length > 2) {
    historyChars -= msgSize(trimmedHistory.shift()!);
  }

  // Fix orphaned messages: first message must be role=user.
  while (trimmedHistory.length > 1 && trimmedHistory[0].role !== "user") {
    trimmedHistory.shift();
  }

  // Fix orphaned tool_use/tool_result pairs:
  // Every assistant message with toolCalls must be followed by a tool_result.
  // Every tool_result must follow an assistant with toolCalls.
  // Drop any that don't have their pair.
  const cleaned: Message[] = [];
  for (let i = 0; i < trimmedHistory.length; i++) {
    const m = trimmedHistory[i];
    if (m.role === "assistant" && m.toolCalls?.length) {
      // Check if next message is tool_result
      const next = trimmedHistory[i + 1];
      if (next?.role === "tool_result") {
        cleaned.push(m, next);
        i++; // skip the tool_result
      }
      // else: orphaned tool_use — drop both
    } else if (m.role === "tool_result") {
      // Orphaned tool_result without preceding tool_use — drop it
    } else {
      cleaned.push(m);
    }
  }

  const messages: Message[] = [...cleaned, { role: "user", content: userMessage }];
  const newMessages: Message[] = [{ role: "user", content: userMessage }];
  const infraRequests: InfraRequest[] = [];
  // Accumulate token usage across every provider round of this turn. Adapters
  // emit "usage" StreamEvents (input on message_start, output on message_delta,
  // etc.); we sum them here so the session can persist real totals.
  const tokenUsage: TokenUsage = { input: 0, output: 0 };

  async function send(event: StreamEvent) {
    const line = `data: ${JSON.stringify(event)}\n\n`;
    // Swallow write failures. If the client disconnected mid-generation (a
    // refresh), the stream write rejects — but that MUST NOT abort the turn.
    // The DO is kept alive by waitUntil, so generation completes and the real
    // reply is persisted; letting the write throw made the turn save an "Error"
    // instead of the reply (the "disappearing conversation" bug). The client
    // reloads the saved transcript via /history.
    await writer.write(encoder.encode(line)).catch(() => {});
  }

  let retries = 0;
  const MAX_RETRIES = 3;

  // Circuit-breaker state: count identical tool calls (tool + path + content) so a
  // model stuck re-issuing the SAME call — e.g. writing a placeholder stub to one
  // file, "apologizing", repeating (the angrry loop) — is stopped instead of
  // burning the whole loop + token budget. Distinct calls (real iteration) don't
  // accumulate, so legitimate repeated edits to a file are unaffected.
  const toolCallCounts = new Map<string, number>();
  const REPEAT_LIMIT = 3;
  // No-progress breaker: consecutive rounds where EVERY file tool errored. Unlike
  // the exact-repeat breaker above, this catches VARIED flailing — e.g. the angrry
  // loop, where each rejected write had a different placeholder ("[2722 bytes…]",
  // "[3038 bytes…]") to a different file, so no two calls were identical. A single
  // successful file op resets it.
  let errorStreak = 0;
  const ERROR_STREAK_LIMIT = 4;

  for (let loop = 0; loop < MAX_LOOPS; loop++) {
    // Stagger API calls — wait between rounds to avoid rate limits
    if (loop > 0) {
      const delay = config.provider === "github" ? 2000 : 500;
      await new Promise((r) => setTimeout(r, delay));
    }

    let assistantText = "";
    const toolCalls: ToolCall[] = [];
    let rateLimited = false;

    try {
      for await (const event of adapter.run(systemPrompt, messages, toolDefinitions)) {
        if (event.type === "done") continue;
        // Catch rate limit errors and retry after delay
        if (event.type === "error" && (event.data.includes("429") || event.data.includes("Rate limited"))) {
          rateLimited = true;
          break;
        }
        await send(event);
        if (event.type === "text") {
          assistantText += event.data;
        } else if (event.type === "tool_call") {
          toolCalls.push(JSON.parse(event.data));
        } else if (event.type === "usage") {
          try {
            const u = JSON.parse(event.data) as Partial<TokenUsage>;
            tokenUsage.input += u.input || 0;
            tokenUsage.output += u.output || 0;
          } catch {
            // Malformed usage payload — ignore, it's display-only.
          }
        } else if (event.type === "error") {
          const errMsg: Message = { role: "assistant", content: event.data };
          newMessages.push(errMsg);
          return { newMessages, infraRequests, tokenUsage };
        }
      }
    } catch (err) {
      // The provider call THREW (network error, timeout, 5xx, malformed
      // response). We `break` the outer loop below — but must first record the
      // failure as an assistant message in `newMessages`, exactly like the
      // `event.type === "error"` path above. Otherwise the turn returns with
      // newMessages = [user] only: the session persists just the user's message,
      // the live error (shown via the SSE above) is lost on reload, and the
      // reopened chat shows only "my initial message" — the disappearing-reply
      // bug. Persisting the error lets the user see what failed and retry.
      const errText = assistantText ? `${assistantText}\n\nError: ${String(err)}` : `Error: ${String(err)}`;
      await send({ type: "error", data: String(err) });
      newMessages.push({ role: "assistant", content: errText });
      onCheckpoint?.(newMessages);
      break;
    }

    // Auto-retry on rate limit with exponential backoff
    if (rateLimited) {
      retries++;
      if (retries > MAX_RETRIES) {
        await send({ type: "error", data: "Rate limited after 3 retries. Wait a minute or switch to a BYOK provider (gear icon)." });
        break;
      }
      const retryDelay = 5000 * retries; // 5s, 10s, 15s
      await send({ type: "text", data: `\n_Rate limited — retrying in ${retryDelay / 1000}s (attempt ${retries}/${MAX_RETRIES})..._\n` });
      await new Promise((r) => setTimeout(r, retryDelay));
      loop--; // retry same iteration
      continue;
    }
    retries = 0; // reset on success

    // Circuit-breaker: if any tool call in this round is an exact repeat past the
    // limit, the model is looping without progress. Stop the turn with guidance
    // BEFORE pushing this round's (repeated) assistant/tool_use message, so the
    // transcript stays clean. Placed here so distinct calls still stream normally.
    let stuck: ToolCall | null = null;
    for (const tc of toolCalls) {
      const sig = toolSignature(tc);
      const n = (toolCallCounts.get(sig) ?? 0) + 1;
      toolCallCounts.set(sig, n);
      if (n > REPEAT_LIMIT) {
        stuck = tc;
        break;
      }
    }
    if (stuck) {
      const path = typeof (stuck.input as Record<string, unknown>)?.path === "string" ? (stuck.input as Record<string, string>).path : "";
      const where = path ? ` on ${path}` : "";
      const note =
        `I got stuck repeating the same \`${stuck.name}\`${where} without making progress, so I stopped instead of ` +
        `looping. This usually means a file's content wasn't coming through correctly. Ask me to rebuild that file ` +
        `from scratch — in smaller pieces if it's large — or send a new message to retry.`;
      await send({ type: "text", data: `\n\n⚠️ ${note}` });
      const stopMsg: Message = { role: "assistant", content: (assistantText ? `${assistantText}\n\n` : "") + `⚠️ ${note}` };
      newMessages.push(stopMsg);
      onCheckpoint?.(newMessages);
      break;
    }

    const assistantMsg: Message = {
      role: "assistant",
      content: assistantText,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
    messages.push(assistantMsg);
    newMessages.push(assistantMsg);
    // Checkpoint the reply the moment it's complete — this is the message the
    // user loses on reload/other-browser when a turn is interrupted before its
    // end-of-turn save.
    onCheckpoint?.(newMessages);

    if (toolCalls.length === 0) break;

    // Separate file tools (execute now) from infra tools (execute in session)
    const fileToolCalls = toolCalls.filter((tc) => !INFRA_TOOLS.has(tc.name));
    const infraToolCalls = toolCalls.filter((tc) => INFRA_TOOLS.has(tc.name));

    // Execute file tools
    const results: ToolResult[] = [];
    for (const tc of fileToolCalls) {
      const result = executeTool(tc, files, storeConfig);
      // Truncate large results in conversation history (e.g. read_file returning full file)
      const truncated = { ...result, content: result.content.slice(0, 1500) };
      results.push(truncated);
      await send({ type: "tool_result", data: JSON.stringify({ id: tc.id, tool: tc.name, result: result.content.slice(0, 400) }) });
    }

    // Collect infra tools — session will execute them and build the
    // complete tool_result message (with real results, not acks)
    for (const tc of infraToolCalls) {
      infraRequests.push({ toolCall: tc });
    }

    if (infraToolCalls.length > 0) {
      // Don't add a tool_result to conversation yet — session will
      // build it with real results and add it to messages
      if (fileToolCalls.length > 0) {
        // Add file tool results only (infra results come from session)
        const fileResultMsg: Message = {
          role: "tool_result",
          content: "",
          toolResults: results,
        };
        messages.push(fileResultMsg);
        newMessages.push(fileResultMsg);
        onCheckpoint?.(newMessages);
      }
      break;
    }

    // Track the no-progress streak: all file tools in this round errored → the
    // model is flailing (e.g. every write rejected as a placeholder). Any success
    // resets it. (Only file rounds reach here; infra rounds broke above.)
    if (results.length > 0 && results.every((r) => r.isError)) errorStreak++;
    else errorStreak = 0;

    // All tools were file tools — add results and continue the loop
    const toolResultMsg: Message = {
      role: "tool_result",
      content: "",
      toolResults: results,
    };
    messages.push(toolResultMsg);
    newMessages.push(toolResultMsg);
    onCheckpoint?.(newMessages);

    if (errorStreak >= ERROR_STREAK_LIMIT) {
      const note =
        `I hit repeated errors writing files (${errorStreak} rounds in a row) without making progress, so I stopped ` +
        `instead of looping. This happens when a file's content isn't coming through correctly. Your deployed game is ` +
        `unchanged and safe. Please start a fresh chat for this game and describe the change again — it'll apply cleanly.`;
      await send({ type: "text", data: `\n\n⚠️ ${note}` });
      const stopMsg: Message = { role: "assistant", content: `⚠️ ${note}` };
      newMessages.push(stopMsg);
      onCheckpoint?.(newMessages);
      break;
    }
  }

  if (infraRequests.length === 0) {
    await send({ type: "done", data: "" });
  }
  return { newMessages, infraRequests, tokenUsage };
}
