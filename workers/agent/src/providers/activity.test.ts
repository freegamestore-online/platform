import { afterEach, describe, expect, it, vi } from "vitest";
import { AnthropicAdapter } from "./anthropic";
import { OpenAIAdapter } from "./openai";
import type { StreamEvent } from "./types";

// #82: a large write_file streams its tool-call INPUT for minutes without a
// single StreamEvent. The adapters must still report that progress through
// onActivity, or the session's hung-turn detector fences off a healthy turn.

function sse(lines: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      // One enqueue per line → one reader chunk per line, like a real stream.
      for (const l of lines) c.enqueue(enc.encode(`${l}\n\n`));
      c.close();
    },
  });
  return { ok: true, status: 200, body } as unknown as Response;
}

async function drain(gen: AsyncGenerator<StreamEvent>, onEvent: (e: StreamEvent) => void) {
  for await (const e of gen) onEvent(e);
}

afterEach(() => vi.unstubAllGlobals());

describe("provider onActivity during tool-call input streaming (#82)", () => {
  it("Anthropic: fires for every input_json_delta chunk even though no event is yielded", async () => {
    const deltas = Array.from(
      { length: 20 },
      (_, i) =>
        `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: i === 0 ? '{"path":"web/src/App.tsx","content":"' : "x".repeat(50) } })}`,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sse([
          `data: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t1", name: "write_file" } })}`,
          ...deltas,
          `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '"}' } })}`,
          `data: ${JSON.stringify({ type: "content_block_stop", index: 0 })}`,
          'event: ping\ndata: {"type":"ping"}',
        ]),
      ),
    );
    let activity = 0;
    let activityBeforeFirstEvent = -1;
    const events: StreamEvent[] = [];
    await drain(
      new AnthropicAdapter("k", "m").run("sys", [], [], () => activity++),
      (e) => {
        if (activityBeforeFirstEvent < 0) activityBeforeFirstEvent = activity;
        events.push(e);
      },
    );
    // Every content chunk counted, before the first event (the finished tool_call) surfaced.
    expect(activityBeforeFirstEvent).toBeGreaterThanOrEqual(deltas.length);
    expect(events.find((e) => e.type === "tool_call")).toBeDefined();
    // Pings keep the connection alive, not the turn: not counted as activity.
    expect(activity).toBe(deltas.length + 3);
  });

  it("OpenAI-compatible: fires for every tool-call argument delta", async () => {
    const argChunks = Array.from(
      { length: 15 },
      (_, i) =>
        `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, ...(i === 0 ? { id: "c1", function: { name: "write_file", arguments: "{" } } : { function: { arguments: '"a":1' } }) }] } }] })}`,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sse([...argChunks, "data: [DONE]"])),
    );
    let activity = 0;
    await drain(
      new OpenAIAdapter("k", "m", "https://example.test").run("sys", [], [], () => activity++),
      () => {},
    );
    expect(activity).toBeGreaterThanOrEqual(argChunks.length);
  });
});
