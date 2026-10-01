import { describe, expect, it, vi } from "vitest";
import type { Message, StreamEvent } from "./providers/types";

// #84: a DO evicted mid-deploy leaves [write_file, deploy] with only the
// write_file result checkpointed. Providers 400 on a tool_use without a
// tool_result, so every later turn failed until /reset.

const seen = vi.hoisted(() => ({ messages: [] as Message[] }));
vi.mock("./providers/anthropic", () => ({
  AnthropicAdapter: class {
    async *run(_s: string, messages: Message[]): AsyncGenerator<StreamEvent> {
      seen.messages = structuredClone(messages);
      yield { type: "text", data: "checking the deploy" };
      yield { type: "done", data: "" };
    }
  },
}));

import { INTERRUPTED_TOOL_RESULT, repairToolPairs, runAgentTurn } from "./agent";
import { getConfig } from "./config";

const write = { id: "w1", name: "write_file", input: { path: "web/src/App.tsx", content: "x" } };
const deploy = { id: "d1", name: "deploy", input: { id: "my-game" } };

/** The exact transcript a mid-deploy eviction leaves behind. */
const evicted = (): Message[] => [
  { role: "user", content: "build a game" },
  { role: "assistant", content: "Writing and deploying.", toolCalls: [write, deploy] },
  { role: "tool_result", content: "", toolResults: [{ id: "w1", content: "wrote App.tsx" }] },
];

function paired(messages: Message[]) {
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === "assistant" && m.toolCalls?.length) {
      const next = messages[i + 1];
      expect(next?.role).toBe("tool_result");
      expect(next.toolResults?.map((r) => r.id)).toEqual(m.toolCalls.map((t) => t.id));
    }
    if (m.role === "tool_result") expect(messages[i - 1]?.toolCalls?.length).toBeGreaterThan(0);
  }
}

describe("repairToolPairs (#84)", () => {
  it("fills a missing result for an interrupted infra call, keeping the real ones", () => {
    const history = evicted();
    const out = repairToolPairs(history);
    paired(out);
    expect(out[2].toolResults).toEqual([
      { id: "w1", content: "wrote App.tsx" },
      { id: "d1", content: INTERRUPTED_TOOL_RESULT, isError: true },
    ]);
    // Never mutates the stored transcript.
    expect(history[2].toolResults).toHaveLength(1);
  });

  it("keeps a trailing tool-call message (eviction before any checkpoint) with interrupted results", () => {
    const out = repairToolPairs(evicted().slice(0, 2));
    paired(out);
    expect(out[1].content).toBe("Writing and deploying."); // the model's turn is not lost
    expect(out[2].toolResults?.every((r) => r.content === INTERRUPTED_TOOL_RESULT)).toBe(true);
  });

  it("drops results that match no tool call and orphaned tool_results", () => {
    const out = repairToolPairs([
      { role: "tool_result", content: "", toolResults: [{ id: "zz", content: "orphan" }] },
      { role: "user", content: "hi" },
      { role: "assistant", content: "", toolCalls: [write] },
      {
        role: "tool_result",
        content: "",
        toolResults: [
          { id: "w1", content: "ok" },
          { id: "stale", content: "from another round" },
        ],
      },
    ]);
    paired(out);
    expect(out.map((m) => m.role)).toEqual(["user", "assistant", "tool_result"]);
    expect(out[2].toolResults).toEqual([{ id: "w1", content: "ok" }]);
  });

  it("leaves complete, well-formed history unchanged", () => {
    const history: Message[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "", toolCalls: [write] },
      { role: "tool_result", content: "", toolResults: [{ id: "w1", content: "ok" }] },
      { role: "assistant", content: "done" },
    ];
    expect(repairToolPairs(history)).toEqual(history);
  });
});

describe("runAgentTurn after a mid-deploy eviction (#84)", () => {
  it("sends the provider a fully paired transcript instead of the poisoned one", async () => {
    const { readable, writable } = new TransformStream<Uint8Array>();
    void readable.pipeTo(new WritableStream()).catch(() => {});
    const config = { provider: "anthropic" as const, model: "m", apiKey: "k", temperature: 0.7, maxTokens: 1000 };
    await runAgentTurn(config, evicted(), "is it live?", new Map(), writable.getWriter(), getConfig("games"));
    paired(seen.messages);
    const results = seen.messages.find((m) => m.role === "tool_result")?.toolResults ?? [];
    expect(results.map((r) => r.id)).toEqual(["w1", "d1"]);
  });
});
