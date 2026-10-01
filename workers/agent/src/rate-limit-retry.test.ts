import { afterEach, describe, expect, it, vi } from "vitest";
import { runAgentTurn } from "./agent";
import { getConfig } from "./config";
import { OpenAIAdapter } from "./providers/openai";
import { isRetryableStatus, type StreamEvent } from "./providers/types";

// #90: the agent retried any provider error whose TEXT contained "429" or
// "Rate limited". "prompt is too long: 204291 tokens" matched, so a permanent
// error was retried 3 times (20s+40s+60s, re-sending the full context) and
// then reported as rate-limiting; while Anthropic's retryable 529 "overloaded"
// was never retried.

const anthropicText = (text: string) =>
  [
    { type: "message_start", message: { usage: { input_tokens: 1 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    { type: "message_stop" },
  ]
    .map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
    .join("");

const ok = (text: string) => new Response(anthropicText(text), { status: 200 });
const fail = (status: number, body: string) => new Response(body, { status });

function drainedWriter(): WritableStreamDefaultWriter<Uint8Array> {
  const { readable, writable } = new TransformStream<Uint8Array>();
  void readable.pipeTo(new WritableStream()).catch(() => {});
  return writable.getWriter();
}

/** Run one Anthropic turn against queued responses, skipping the back-offs. */
async function turn(responses: Response[]) {
  const fetchMock = vi.fn(async () => responses.shift() ?? ok("fallback"));
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers();
  const done = runAgentTurn(
    { provider: "anthropic", model: "claude-x", apiKey: "k", maxTokens: 1000 },
    [],
    "build it",
    new Map(),
    drainedWriter(),
    getConfig("games"),
  );
  await vi.advanceTimersByTimeAsync(200_000);
  const result = await done;
  return { result, calls: fetchMock.mock.calls.length, last: result.newMessages.at(-1)?.content ?? "" };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("provider error retries (#90)", () => {
  it("does not retry a permanent error that merely contains the digits 429", async () => {
    const { calls, last } = await turn([
      fail(400, '{"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 204291 tokens > 200000 maximum"}}'),
    ]);
    expect(calls).toBe(1);
    expect(last).toContain("prompt is too long");
    expect(last).not.toMatch(/rate-limited/i);
  });

  it("retries Anthropic's 529 overloaded and recovers", async () => {
    const { calls, last } = await turn([
      fail(529, '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}'),
      ok("Built it."),
    ]);
    expect(calls).toBe(2);
    expect(last).toBe("Built it.");
  });

  it("retries an overloaded_error that arrives mid-stream", async () => {
    const midStream = new Response(
      `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 1 } } })}\n\n` +
        `event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } })}\n\n`,
      { status: 200 },
    );
    const { calls, last } = await turn([midStream, ok("Built it.")]);
    expect(calls).toBe(2);
    expect(last).toBe("Built it.");
  });

  it("still retries a 429 rate limit", async () => {
    const { calls, last } = await turn([fail(429, '{"error":{"type":"rate_limit_error"}}'), ok("Built it.")]);
    expect(calls).toBe(2);
    expect(last).toBe("Built it.");
  });

  it("gives up after 3 retries on a persistent overload, saying so", async () => {
    const overloaded = () => fail(529, '{"error":{"type":"overloaded_error"}}');
    const { calls, last } = await turn([overloaded(), overloaded(), overloaded(), overloaded()]);
    expect(calls).toBe(4);
    expect(last).toMatch(/overloaded/i);
  });
});

describe("structured retryability", () => {
  it("only 429 and 529 are retryable statuses", () => {
    expect([429, 529].every(isRetryableStatus)).toBe(true);
    expect([400, 401, 403, 404, 413, 500, 502, undefined].some(isRetryableStatus)).toBe(false);
  });

  it("the OpenAI-format adapter flags by status, not by message text", async () => {
    const collect = async (res: Response) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => res),
      );
      const out: StreamEvent[] = [];
      for await (const e of new OpenAIAdapter("k", "m").run("s", [], [])) out.push(e);
      return out.find((e) => e.type === "error");
    };
    expect(await collect(fail(400, "context length 4290 exceeded; 429 tokens over"))).toMatchObject({
      status: 400,
      retryable: false,
    });
    expect(await collect(fail(529, "overloaded"))).toMatchObject({ status: 529, retryable: true });
    expect(await collect(fail(429, "slow down"))).toMatchObject({ status: 429, retryable: true });
  });
});
