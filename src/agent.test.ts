import { describe, expect, it, vi } from "vitest";

// Mock the Anthropic provider so its adapter throws when the turn starts
// streaming — simulating a provider network error / 5xx / malformed response
// (the class of failure that surfaced the "only my first message survives" bug).
vi.mock("./providers/anthropic", () => ({
  AnthropicAdapter: class {
    // eslint-disable-next-line require-yield
    async *run(): AsyncGenerator<never> {
      throw new Error("upstream 503");
    }
  },
}));

import { runAgentTurn } from "./agent";
import { getConfig } from "./config";

/** A writer whose stream is continuously drained, so send() never blocks. */
function drainedWriter(): WritableStreamDefaultWriter<Uint8Array> {
  const { readable, writable } = new TransformStream<Uint8Array>();
  const reader = readable.getReader();
  void (async () => {
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
  })();
  return writable.getWriter();
}

describe("runAgentTurn — provider throw", () => {
  it("persists an assistant error message so the turn survives a reload", async () => {
    const config = { provider: "anthropic", model: "claude-x", temperature: 0.7, maxTokens: 1000 };
    const result = await runAgentTurn(config, [], "Angry birds game", new Map(), drainedWriter(), getConfig("games"));

    // The user message is always first…
    expect(result.newMessages[0]).toEqual({ role: "user", content: "Angry birds game" });
    // …and CRUCIALLY the thrown error is recorded as an assistant message, not
    // dropped. Before the fix, newMessages was [user] only → the session
    // persisted just the user's message and the reload showed an empty-looking
    // chat with only "my initial message".
    expect(result.newMessages.length).toBeGreaterThanOrEqual(2);
    const last = result.newMessages[result.newMessages.length - 1];
    expect(last.role).toBe("assistant");
    expect(last.content).toContain("Error:");
    expect(last.content).toContain("upstream 503");
  });
});
