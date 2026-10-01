import { afterEach, describe, expect, it, vi } from "vitest";
import { runAgentTurn } from "../agent";
import { getConfig } from "../config";
import { OPENROUTER_CHAT_URL } from "./openrouter";

// #89: OpenRouter was offered in the Studio and its keys were stored in the
// vault, but createAdapter had no case for it — every turn by a creator who
// picked OpenRouter failed with "Unknown AI provider: openrouter".

function sse(lines: unknown[]): Response {
  const body = `${lines.map((l) => `data: ${JSON.stringify(l)}`).join("\n\n")}\n\ndata: [DONE]\n\n`;
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function drainedWriter(): WritableStreamDefaultWriter<Uint8Array> {
  const { readable, writable } = new TransformStream<Uint8Array>();
  void readable.pipeTo(new WritableStream()).catch(() => {});
  return writable.getWriter();
}

afterEach(() => vi.unstubAllGlobals());

describe("OpenRouter provider (#89)", () => {
  it("runs a turn against OpenRouter with the creator's key and model", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return sse([
          // OpenRouter streams the OpenAI chat-completions format.
          { choices: [{ delta: { content: "Building your " } }] },
          { choices: [{ delta: { content: "space game." } }] },
          { choices: [], usage: { prompt_tokens: 12, completion_tokens: 5 } },
        ]);
      }),
    );
    const result = await runAgentTurn(
      { provider: "openrouter", model: "anthropic/claude-sonnet-4", apiKey: "sk-or-test", temperature: 0.7, maxTokens: 1000 },
      [],
      "make a space game",
      new Map(),
      drainedWriter(),
      getConfig("games"),
    );

    expect(calls[0]?.url).toBe(OPENROUTER_CHAT_URL);
    expect(new Headers(calls[0]?.init.headers).get("Authorization")).toBe("Bearer sk-or-test");
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body.model).toBe("anthropic/claude-sonnet-4");
    expect(body.tools?.length).toBeGreaterThan(0); // the agent's tools are offered

    const reply = result.newMessages.at(-1);
    expect(reply?.role).toBe("assistant");
    expect(reply?.content).toBe("Building your space game.");
    expect(result.tokenUsage).toEqual({ input: 12, output: 5 });
  });

  it("passes OpenRouter's tool calls through like any OpenAI-format provider", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          sse([
            {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: "call_1",
                        function: { name: "write_file", arguments: '{"path":"web/src/App.tsx","content":"export default () => null;\\n"}' },
                      },
                    ],
                  },
                },
              ],
            },
            { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
          ]),
        )
        .mockResolvedValue(sse([{ choices: [{ delta: { content: "Done." } }] }])),
    );
    const files = new Map<string, string>();
    await runAgentTurn(
      { provider: "openrouter", model: "openai/gpt-4.1", apiKey: "sk-or-test" },
      [],
      "write the app",
      files,
      drainedWriter(),
      getConfig("games"),
    );
    expect(files.get("web/src/App.tsx")).toBe("export default () => null;\n");
  });
});
