import { describe, expect, it, vi } from "vitest";
import type { StreamEvent } from "./providers/types";

// #82: runAgentTurn must forward provider liveness to the session (and count
// its own client writes), so a minutes-long tool-call stream keeps the turn
// "active" for the hung-turn detector.
const CHUNKS = 12;
vi.mock("./providers/anthropic", () => ({
  AnthropicAdapter: class {
    async *run(_s: string, _m: unknown, _t: unknown, onActivity?: () => void): AsyncGenerator<StreamEvent> {
      for (let i = 0; i < CHUNKS; i++) onActivity?.(); // tool input streaming: no events
      yield { type: "text", data: "done building" };
      yield { type: "done", data: "" };
    }
  },
}));

import { runAgentTurn } from "./agent";
import { getConfig } from "./config";

function drainedWriter(): WritableStreamDefaultWriter<Uint8Array> {
  const { readable, writable } = new TransformStream<Uint8Array>();
  void readable.pipeTo(new WritableStream()).catch(() => {});
  return writable.getWriter();
}

describe("runAgentTurn liveness (#82)", () => {
  it("forwards provider activity and its own stream writes to onActivity", async () => {
    const onActivity = vi.fn();
    const config = { provider: "anthropic" as const, model: "claude-x", apiKey: "k", temperature: 0.7, maxTokens: 1000 };
    await runAgentTurn(config, [], "build it", new Map(), drainedWriter(), getConfig("games"), undefined, undefined, onActivity);
    // Provider chunks (CHUNKS) plus at least the one text event written to the client.
    expect(onActivity.mock.calls.length).toBeGreaterThanOrEqual(CHUNKS + 1);
  });
});
