import { createStreamTimeout } from "./timeout";
import { isRetryableStatus, type Message, type ProviderAdapter, type StreamEvent, type ToolCall, type ToolDef } from "./types";

export class AnthropicAdapter implements ProviderAdapter {
  constructor(
    private apiKey: string,
    private model: string,
    private temperature: number = 0.7,
    private maxTokens: number = 16384,
  ) {}

  async *run(systemPrompt: string, messages: Message[], tools: ToolDef[], onActivity?: () => void): AsyncGenerator<StreamEvent> {
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      system: systemPrompt,
      messages: toAnthropicMessages(messages),
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      })),
      stream: true,
    };

    const timeout = createStreamTimeout();
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: timeout.signal,
      });

      if (!res.ok) {
        const err = await res.text();
        yield {
          type: "error",
          data: `Anthropic API error ${res.status}: ${err}`,
          status: res.status,
          retryable: isRetryableStatus(res.status),
        };
        return;
      }

      yield* parseAnthropicSSE(res.body!, () => {
        timeout.reset();
        onActivity?.();
      });
    } catch (err) {
      yield {
        type: "error",
        data: timeout.signal.aborted ? "Anthropic request timed out (no response)." : `Anthropic request failed: ${String(err)}`,
      };
    } finally {
      timeout.clear();
    }
  }
}

function toAnthropicMessages(messages: Message[]): unknown[] {
  const out: unknown[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      const content: unknown[] = [];
      if (m.content) content.push({ type: "text", text: m.content });
      if (m.toolCalls) {
        for (const tc of m.toolCalls) {
          content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input });
        }
      }
      out.push({ role: "assistant", content });
    } else if (m.role === "tool_result") {
      const content = (m.toolResults || []).map((tr) => ({
        type: "tool_result" as const,
        tool_use_id: tr.id,
        content: tr.content,
        is_error: tr.isError || false,
      }));
      out.push({ role: "user", content });
    }
  }
  return out;
}

async function* parseAnthropicSSE(body: ReadableStream, onChunk?: () => void): AsyncGenerator<StreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const toolCalls: Map<number, { id: string; name: string; jsonBuf: string }> = new Map();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      // Reset the idle-timeout clock only on REAL progress. Anthropic keeps a
      // queued/throttled request alive with periodic `ping` events — counting
      // those as progress defeated the idle abort entirely, and a throttled
      // request could sit "streaming" pings for 25+ minutes (the maze-racer
      // hangs, 2026-07-11). Pings keep the CONNECTION alive; only content
      // should keep the TURN alive.
      if (!/^event: ping|"type"\s*:\s*"ping"/m.test(text)) onChunk?.();
      buf += text;

      const lines = buf.split("\n");
      buf = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === "[DONE]") continue;

        let evt: any;
        try {
          evt = JSON.parse(raw);
        } catch {
          continue;
        }

        if (evt.type === "error") {
          // A mid-stream error event (e.g. overloaded_error once streaming has
          // begun) used to be ignored, ending the turn silently. Surface it;
          // overload is Anthropic's 529 and is worth retrying (#90).
          const kind = String(evt.error?.type ?? "error");
          const overloaded = kind === "overloaded_error";
          yield {
            type: "error",
            data: `Anthropic stream error: ${kind}${evt.error?.message ? ` — ${evt.error.message}` : ""}`,
            ...(overloaded ? { status: 529, retryable: true } : {}),
          };
          return;
        }
        if (evt.type === "content_block_start") {
          const block = evt.content_block;
          if (block.type === "tool_use") {
            toolCalls.set(evt.index, { id: block.id, name: block.name, jsonBuf: "" });
          }
        } else if (evt.type === "content_block_delta") {
          const delta = evt.delta;
          if (delta.type === "text_delta") {
            yield { type: "text", data: delta.text };
          } else if (delta.type === "input_json_delta") {
            const tc = toolCalls.get(evt.index);
            if (tc) tc.jsonBuf += delta.partial_json;
          }
        } else if (evt.type === "content_block_stop") {
          const tc = toolCalls.get(evt.index);
          if (tc) {
            let input: Record<string, unknown> = {};
            try {
              input = JSON.parse(tc.jsonBuf);
            } catch {
              /* empty */
            }
            const call: ToolCall = { id: tc.id, name: tc.name, input };
            yield { type: "tool_call", data: JSON.stringify(call) };
            toolCalls.delete(evt.index);
          }
        } else if (evt.type === "message_start" && evt.message?.usage) {
          // Input tokens from message_start
          yield {
            type: "usage",
            data: JSON.stringify({
              input: evt.message.usage.input_tokens || 0,
              output: 0,
            }),
          };
        } else if (evt.type === "message_delta") {
          // Output tokens from message_delta (end of message)
          if (evt.usage) {
            yield {
              type: "usage",
              data: JSON.stringify({ input: 0, output: evt.usage.output_tokens || 0 }),
            };
          }
          // Surface a length cutoff. `stop_reason: "max_tokens"` means the model
          // ran out of output budget mid-response — often mid write_file, leaving
          // a truncated file. Make it VISIBLE (it used to stall silently) so the
          // user knows to ask it to continue; the write_file truncation guard
          // (tools.ts) separately rejects the destructive partial write.
          if (evt.delta?.stop_reason === "max_tokens") {
            yield {
              type: "text",
              data: '\n\n⚠️ My response was cut off at the length limit — the last file may be incomplete. Ask me to "continue" and I\'ll finish it.',
            };
          }
        }
      }
    }
  } finally {
    // cancel() (not just releaseLock) so an early break out of the consuming
    // `for await` — rate-limit/error paths in agent.ts — closes the upstream
    // response body instead of leaking the connection.
    await reader.cancel().catch(() => {});
  }

  yield { type: "done", data: "" };
}
