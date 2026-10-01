/** Unified types across AI providers */

export type Provider = "anthropic" | "openai" | "google" | "github" | "openrouter";

export interface AIConfig {
  provider: Provider;
  model: string;
  apiKey: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  content: string;
  isError?: boolean;
}

export interface TokenUsage {
  input: number;
  output: number;
}

export interface StreamEvent {
  type: "text" | "tool_call" | "tool_result" | "done" | "error" | "usage";
  /** For text: the delta. For tool_call: JSON of ToolCall. For usage: JSON of TokenUsage. */
  data: string;
  /** error only: the provider's HTTP status, when the failure had one. */
  status?: number;
  /** error only: a transient capacity error worth retrying after a back-off.
   *  The agent loop retries on THIS flag — never by searching the message
   *  text, which matched "429" inside e.g. "prompt is too long: 204291
   *  tokens" (#90). */
  retryable?: boolean;
}

/** 429 = rate limited; 529 = provider overloaded (Anthropic). Both clear on
 *  their own; anything else (bad request, auth, context too long) won't. */
export function isRetryableStatus(status: number | undefined): boolean {
  return status === 429 || status === 529;
}

/** What the provider adapter must implement */
export interface ProviderAdapter {
  /** Run one turn of the agent loop. Yields StreamEvents. `onActivity` fires on
   *  every content chunk received from the provider — including chunks that
   *  yield no event, such as a tool call's input streaming in — so the session
   *  can tell a long legitimate stream from a hung one (#82). */
  run(systemPrompt: string, messages: Message[], tools: ToolDef[], onActivity?: () => void): AsyncGenerator<StreamEvent>;
}

export interface Message {
  role: "user" | "assistant" | "tool_result";
  content: string;
  /** Only for tool_result messages */
  toolResults?: ToolResult[];
  /** Only for assistant messages that include tool calls */
  toolCalls?: ToolCall[];
  /** Epoch ms when the message was appended. Absent on messages stored before
   *  timestamps shipped. Adapters rebuild provider payloads field-by-field, so
   *  this never reaches a provider API. */
  ts?: number;
}
