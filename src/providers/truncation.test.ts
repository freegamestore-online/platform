import { afterEach, describe, expect, it, vi } from "vitest";
import { AnthropicAdapter } from "./anthropic";
import { OpenAIAdapter } from "./openai";
import { GoogleAdapter } from "./google";
import type { StreamEvent } from "./types";

// Build a fetch Response whose body streams the given SSE `data:` lines, so we
// can drive each adapter's real SSE parser and assert what StreamEvents it emits.
function sseResponse(lines: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const l of lines) controller.enqueue(enc.encode(`data: ${l}\n\n`));
      controller.close();
    },
  });
  return { ok: true, status: 200, body } as unknown as Response;
}

function stubFetch(lines: string[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => sseResponse(lines)),
  );
}

async function collect(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const texts = (events: StreamEvent[]) => events.filter((e) => e.type === "text").map((e) => e.data).join("");

afterEach(() => vi.unstubAllGlobals());

// A length cutoff is NOT an API error — every provider returns a normal 200 with
// a stop/finish reason. These tests pin that we DETECT the reason and surface a
// visible "cut off" note, so a mid-write_file truncation can never stall silently
// again (the angrry incident).
describe("provider adapters surface a max_tokens cutoff", () => {
  it("Anthropic: stop_reason 'max_tokens' → visible cutoff note", async () => {
    stubFetch([
      JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 10 } } }),
      JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "half a file" } }),
      JSON.stringify({ type: "message_delta", delta: { stop_reason: "max_tokens" }, usage: { output_tokens: 5 } }),
    ]);
    const events = await collect(new AnthropicAdapter("k", "claude-x").run("sys", [{ role: "user", content: "hi" }], []));
    expect(texts(events)).toContain("half a file");
    expect(texts(events)).toContain("cut off");
  });

  it("OpenAI: finish_reason 'length' → visible cutoff note", async () => {
    stubFetch([
      JSON.stringify({ choices: [{ delta: { content: "half a file" }, finish_reason: null }] }),
      JSON.stringify({ choices: [{ delta: {}, finish_reason: "length" }] }),
      "[DONE]",
    ]);
    const events = await collect(new OpenAIAdapter("k", "gpt-x").run("sys", [{ role: "user", content: "hi" }], []));
    expect(texts(events)).toContain("half a file");
    expect(texts(events)).toContain("cut off");
  });

  it("Google: finishReason 'MAX_TOKENS' → visible cutoff note (even with no content parts)", async () => {
    stubFetch([
      JSON.stringify({ candidates: [{ content: { parts: [{ text: "half a file" }] } }] }),
      JSON.stringify({ candidates: [{ finishReason: "MAX_TOKENS" }] }),
    ]);
    const events = await collect(new GoogleAdapter("k", "gemini-x").run("sys", [{ role: "user", content: "hi" }], []));
    expect(texts(events)).toContain("half a file");
    expect(texts(events)).toContain("cut off");
  });

  it("does NOT warn on a normal stop (guards against false 'cut off' noise)", async () => {
    stubFetch([
      JSON.stringify({ choices: [{ delta: { content: "a complete file" }, finish_reason: null }] }),
      JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }),
      "[DONE]",
    ]);
    const events = await collect(new OpenAIAdapter("k", "gpt-x").run("sys", [{ role: "user", content: "hi" }], []));
    expect(texts(events)).toContain("a complete file");
    expect(texts(events)).not.toContain("cut off");
  });
});
