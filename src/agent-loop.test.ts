import { describe, expect, it, vi } from "vitest";

// Mock the Anthropic adapter so it ALWAYS yields the same write_file call —
// simulating a model stuck writing a placeholder stub to one file and looping
// (the angrry incident). The loop circuit-breaker must stop this quickly instead
// of running all MAX_LOOPS rounds and burning the token budget.
vi.mock("./providers/anthropic", () => ({
  AnthropicAdapter: class {
    private n = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async *run(): AsyncGenerator<any> {
      this.n++;
      yield { type: "text", data: "writing levels" };
      yield {
        type: "tool_call",
        // Same name + input every round → same toolSignature. The id varies (as it
        // would in reality); the breaker keys on tool+path+content, not id.
        data: JSON.stringify({
          id: `call-${this.n}`,
          name: "write_file",
          input: { path: "web/src/lib/levels.ts", content: "[3038 bytes written to web/src/lib/levels.ts]" },
        }),
      };
      yield { type: "done", data: "" };
    }
  },
}));

// A SECOND mock: the model flails with DIFFERENT placeholder content to DIFFERENT
// files each round (the real angrry pattern) — so the exact-repeat breaker can't
// catch it, but the no-progress (all-errors) breaker must.
vi.mock("./providers/openai", () => ({
  OpenAIAdapter: class {
    private n = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async *run(): AsyncGenerator<any> {
      this.n++;
      const files = ["levels.ts", "physics.ts", "renderer.ts", "canvas.ts", "types.ts", "App.tsx"];
      const path = `web/src/lib/${files[this.n % files.length]}`;
      yield { type: "text", data: "writing" };
      yield {
        type: "tool_call",
        // Different path + different byte count each round → different signatures,
        // but every write is a placeholder → every round all-errors.
        data: JSON.stringify({
          id: `c-${this.n}`,
          name: "write_file",
          input: { path, content: `[${2000 + this.n * 137} bytes written to ${path}]` },
        }),
      };
      yield { type: "done", data: "" };
    }
  },
}));

import { runAgentTurn, toolSignature } from "./agent";
import { getConfig } from "./config";

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

describe("runAgentTurn — loop circuit-breaker", () => {
  it("stops a model repeating the same tool call instead of looping to MAX_LOOPS", async () => {
    const config = { provider: "anthropic", model: "claude-x", temperature: 0.7, maxTokens: 1000 };
    const files = new Map<string, string>();
    const result = await runAgentTurn(config, [], "make the levels", files, drainedWriter(), getConfig("games"));

    // The turn ends with a clear "I got stuck repeating" assistant note…
    const last = result.newMessages[result.newMessages.length - 1];
    expect(last.role).toBe("assistant");
    expect(last.content).toContain("stuck repeating");

    // …after only a few rounds (REPEAT_LIMIT = 3), nowhere near MAX_LOOPS (25).
    const assistantWithTool = result.newMessages.filter((m) => m.role === "assistant" && m.toolCalls);
    expect(assistantWithTool.length).toBeLessThanOrEqual(3);

    // …and the placeholder was NEVER written (write_file's placeholder guard).
    expect(files.has("web/src/lib/levels.ts")).toBe(false);
  });

  it("stops VARIED placeholder flailing (different files/bytes) via the no-progress breaker", async () => {
    // The real angrry pattern: each rejected write differs, so the exact-repeat
    // breaker can't catch it — the all-errors streak must. MAX_LOOPS is 25; this
    // must stop well before that (ERROR_STREAK_LIMIT = 4).
    const config = { provider: "openai", model: "gpt-x", temperature: 0.7, maxTokens: 1000 };
    const files = new Map<string, string>();
    const result = await runAgentTurn(config, [], "fix the physics", files, drainedWriter(), getConfig("games"));

    const last = result.newMessages[result.newMessages.length - 1];
    expect(last.role).toBe("assistant");
    expect(last.content).toContain("repeated errors writing files");
    // Rounds with a tool call — should be ~ERROR_STREAK_LIMIT, far below MAX_LOOPS.
    const rounds = result.newMessages.filter((m) => m.role === "assistant" && m.toolCalls).length;
    expect(rounds).toBeLessThanOrEqual(5);
    // No placeholder file was ever created.
    expect(files.size).toBe(0);
  });
});

describe("toolSignature", () => {
  it("is stable across ids but distinguishes tool, path, and content", () => {
    const a = toolSignature({ id: "x1", name: "write_file", input: { path: "a.ts", content: "hello" } });
    const aAgain = toolSignature({ id: "x2", name: "write_file", input: { path: "a.ts", content: "hello" } });
    const diffContent = toolSignature({ id: "x3", name: "write_file", input: { path: "a.ts", content: "world" } });
    const diffPath = toolSignature({ id: "x4", name: "write_file", input: { path: "b.ts", content: "hello" } });
    const diffTool = toolSignature({ id: "x5", name: "read_file", input: { path: "a.ts", content: "hello" } });

    expect(a).toBe(aAgain); // identical call (different id) → same signature
    expect(a).not.toBe(diffContent); // real iteration (new content) → different
    expect(a).not.toBe(diffPath);
    expect(a).not.toBe(diffTool);
  });
});
