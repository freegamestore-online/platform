import { describe, expect, it } from "vitest";
import type { Message } from "./providers/types";
import { elidedBodyMarker, enforceSessionBudget, healPoisonedHistory, stripLargeToolCallBodies } from "./session-budget";
import { looksLikePlaceholder } from "./tools";

describe("stripLargeToolCallBodies", () => {
  it("replaces a large write_file body with a NON-imitable instructional marker", () => {
    const body = "x".repeat(50_000);
    const messages: Message[] = [
      { role: "user", content: "make it" },
      { role: "assistant", content: "", toolCalls: [{ id: "t1", name: "write_file", input: { path: "web/src/App.tsx", content: body } }] },
    ];
    stripLargeToolCallBodies(messages, 2048);
    const stored = messages[1].toolCalls![0].input.content as string;
    // CRITICAL: must NOT be the old "[N bytes written to path]" form — that read
    // like content and the model imitated it (the angrry poisoning loop).
    expect(stored).not.toMatch(/^\[\d+ bytes written to/);
    expect(stored).toBe(elidedBodyMarker("web/src/App.tsx"));
    // And the marker is itself recognized as a placeholder, so if the model ever
    // copies it back as content, write_file rejects it.
    expect(looksLikePlaceholder(stored)).toBe(true);
    // Other input fields survive.
    expect(messages[1].toolCalls![0].input.path).toBe("web/src/App.tsx");
  });

  it("leaves small write_file bodies untouched", () => {
    const messages: Message[] = [
      { role: "assistant", content: "", toolCalls: [{ id: "t1", name: "write_file", input: { path: "a.txt", content: "tiny" } }] },
    ];
    stripLargeToolCallBodies(messages, 2048);
    expect(messages[0].toolCalls![0].input.content).toBe("tiny");
  });

  it("never mutates the original message objects (shared with the live turn)", () => {
    // The session's message array holds the SAME objects as the in-flight
    // turn's context (checkpoint persists shared references). Eliding must
    // clone — an in-place swap leaked the marker into the model's live context
    // mid-turn, and it imitated the marker as its next file's content (the
    // flappyslaybird 2026-07-11 rejected-write loop).
    const body = "z".repeat(50_000);
    const original: Message = {
      role: "assistant",
      content: "",
      toolCalls: [{ id: "t1", name: "write_file", input: { path: "web/src/lib/draw.ts", content: body } }],
    };
    const messages: Message[] = [original];
    stripLargeToolCallBodies(messages, 2048);
    // The array slot got a cloned, elided message...
    expect(messages[0].toolCalls![0].input.content).toBe(elidedBodyMarker("web/src/lib/draw.ts"));
    // ...but the ORIGINAL object (still referenced by the live turn) is intact.
    expect(original.toolCalls![0].input.content).toBe(body);
  });

  it("does not touch non-write_file tool calls", () => {
    const big = "y".repeat(50_000);
    const messages: Message[] = [
      { role: "assistant", content: "", toolCalls: [{ id: "t1", name: "deploy", input: { id: "snake", content: big } }] },
    ];
    stripLargeToolCallBodies(messages, 2048);
    expect(messages[0].toolCalls![0].input.content).toBe(big);
  });
});

describe("healPoisonedHistory (breaks the placeholder-imitation loop)", () => {
  it("removes a poisoned write turn (+ its tool_result) and leaves a TEXT breadcrumb — no placeholder reaches the model", () => {
    // The angrry poison: a past write_file whose content is a placeholder (old
    // "[N bytes written…]" OR the new elided-marker — the model imitates either).
    for (const poison of ["[2714 bytes written to web/src/lib/levels.ts]", elidedBodyMarker("web/src/lib/levels.ts")]) {
      const messages: Message[] = [
        { role: "user", content: "fix the physics" },
        {
          role: "assistant",
          content: "writing levels",
          toolCalls: [{ id: "t1", name: "write_file", input: { path: "web/src/lib/levels.ts", content: poison } }],
        },
        { role: "tool_result", content: "", toolResults: [{ id: "t1", content: "Wrote web/src/lib/levels.ts" }] },
        { role: "user", content: "done?" },
      ];
      const out = healPoisonedHistory(messages);
      // The poisoned assistant turn AND its tool_result are gone…
      expect(out.some((m) => m.role === "assistant" && m.toolCalls)).toBe(false);
      expect(out.some((m) => m.role === "tool_result")).toBe(false);
      // …replaced by a plain-text breadcrumb naming the file (no content body).
      const crumb = out.find((m) => m.role === "assistant");
      expect(crumb!.content).toContain("web/src/lib/levels.ts");
      expect(crumb!.toolCalls).toBeUndefined();
      // CRITICAL: no message anywhere still carries the placeholder content.
      expect(JSON.stringify(out)).not.toContain("bytes written to");
      expect(JSON.stringify(out)).not.toContain("already saved");
      // The surrounding real messages survive.
      expect(out[0]).toEqual({ role: "user", content: "fix the physics" });
      expect(out.at(-1)).toEqual({ role: "user", content: "done?" });
    }
  });

  it("leaves real source and non-write tool calls untouched", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "t1", name: "write_file", input: { path: "a.ts", content: "export const A = 1;" } }],
      },
      { role: "tool_result", content: "", toolResults: [{ id: "t1", content: "Wrote a.ts" }] },
      { role: "assistant", content: "", toolCalls: [{ id: "t2", name: "read_file", input: { path: "a.ts" } }] },
      { role: "tool_result", content: "", toolResults: [{ id: "t2", content: "export const A = 1;" }] },
    ];
    const out = healPoisonedHistory(messages);
    expect(out).toHaveLength(4); // nothing dropped
    expect(out[0].toolCalls![0].input.content).toBe("export const A = 1;");
  });
});

describe("enforceSessionBudget — anti-brick guard", () => {
  it("keeps a huge files map + huge transcript under the soft cap without throwing", () => {
    // A large files map (authoritative) is NOT in the transcript; the transcript
    // itself is what's trimmed. Simulate both being large.
    const files: Record<string, string> = {};
    for (let i = 0; i < 100; i++) files[`web/src/file${i}.ts`] = "z".repeat(10_000); // ~1 MB of files

    const messages: Message[] = [];
    for (let i = 0; i < 60; i++) {
      // Each assistant turn carries a big write_file body — exactly what used to
      // bloat the blob past the DO cap.
      messages.push({ role: "user", content: `turn ${i}` });
      messages.push({
        role: "assistant",
        content: "done",
        toolCalls: [{ id: `t${i}`, name: "write_file", input: { path: `web/src/file${i}.ts`, content: "z".repeat(40_000) } }],
      });
    }

    const session = { files, messages, tokenUsage: { input: 0, output: 0 } };
    const softMax = 1.4 * 1024 * 1024;

    const trimmed = enforceSessionBudget(session, { softMaxBytes: softMax, toolCallMaxBytes: 2048 });

    // The guard engaged: write_file bodies were placeholdered (huge saving) so
    // trimming may not even be needed — but the result must fit regardless.
    expect(JSON.stringify(session).length).toBeLessThanOrEqual(softMax);
    // Placeholders replaced the 40 KB bodies.
    const anyBig = session.messages.some((m) =>
      m.toolCalls?.some((tc) => typeof tc.input.content === "string" && (tc.input.content as string).length > 5000),
    );
    expect(anyBig).toBe(false);
    expect(trimmed).toBeGreaterThanOrEqual(0);
  });

  it("trims oldest messages when the transcript alone is over budget", () => {
    // Force trimming: many plain messages, tiny soft cap, nothing to placeholder.
    const messages: Message[] = [];
    for (let i = 0; i < 40; i++) messages.push({ role: "user", content: `m${i} ${"a".repeat(200)}` });
    const session = { messages };

    const before = messages.length;
    const trimmed = enforceSessionBudget(session, { softMaxBytes: 2000, toolCallMaxBytes: 2048 });

    expect(trimmed).toBeGreaterThan(0);
    expect(session.messages.length).toBe(before - trimmed);
    expect(JSON.stringify(session).length).toBeLessThanOrEqual(2000);
    // Never trims below the last message.
    expect(session.messages.length).toBeGreaterThanOrEqual(1);
  });

  it("never trims the final message even if a single message exceeds the cap", () => {
    const session = { messages: [{ role: "user", content: "q".repeat(10_000) }] as Message[] };
    const trimmed = enforceSessionBudget(session, { softMaxBytes: 100, toolCallMaxBytes: 2048 });
    expect(trimmed).toBe(0);
    expect(session.messages.length).toBe(1);
  });

  it("measures UTF-8 BYTES, not UTF-16 length — multibyte content can't sneak past the cap", () => {
    // Each emoji is 1 JS string "char" via .length accounting in the OLD code but
    // 4 UTF-8 bytes. A transcript that looks small by .length must still be
    // trimmed when its real byte size exceeds the cap.
    const emoji = "😀"; // 2 UTF-16 code units, 4 UTF-8 bytes
    const messages: Message[] = [];
    for (let i = 0; i < 40; i++) messages.push({ role: "user", content: emoji.repeat(300) });
    const session = { messages };

    const charLen = JSON.stringify(session).length;
    const byteLen = new TextEncoder().encode(JSON.stringify(session)).length;
    // Sanity: bytes materially exceed UTF-16 length for this content.
    expect(byteLen).toBeGreaterThan(charLen);

    const softMax = 4000; // bytes
    const trimmed = enforceSessionBudget(session, { softMaxBytes: softMax, toolCallMaxBytes: 2048 });
    expect(trimmed).toBeGreaterThan(0);
    // The result must fit the cap in BYTES (the unit the DO enforces).
    expect(new TextEncoder().encode(JSON.stringify(session)).length).toBeLessThanOrEqual(softMax);
  });

  it("never leaves a leading orphaned tool_result after trimming (would 400 the provider)", () => {
    // The oldest turn is assistant(tool_use) → tool_result. If the assistant is
    // trimmed but the tool_result survives at the head, the next provider call
    // 400s. The guard must drop the orphaned tool_result too.
    const messages: Message[] = [
      { role: "assistant", content: "", toolCalls: [{ id: "t0", name: "write_file", input: { path: "a.ts", content: "x".repeat(2000) } }] },
      { role: "tool_result", content: "", toolResults: [{ id: "t0", content: "ok" }] },
      { role: "user", content: "b".repeat(2000) },
      { role: "assistant", content: "reply".repeat(400) },
    ];
    const session = { messages };
    enforceSessionBudget(session, { softMaxBytes: 1500, toolCallMaxBytes: 2048 });
    expect(session.messages[0].role).not.toBe("tool_result");
  });
});
