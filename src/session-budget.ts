/** Storage-budget enforcement for the persisted session blob.
 *
 * The whole session (files + transcript + seed) is persisted as ONE Durable
 * Object value, and a SQLite-backed DO caps a single key+value at ~2 MB. If the
 * blob outgrows that, `storage.put()` throws and the session freezes (only
 * /reset escapes). This keeps the blob under a soft cap without ever throwing:
 *
 *   1. Replace large write_file tool-call bodies in the transcript with a short
 *      placeholder — the live `files` map is authoritative, so the transcript
 *      never needs to carry file bodies.
 *   2. If the estimated serialized size is still over the soft cap, drop the
 *      oldest messages until it fits.
 *
 * Pure (mutates the passed object, returns how many messages were trimmed) so it
 * can be unit-tested without standing up a Durable Object.
 */

import type { Message } from "./providers/types";

export interface BudgetOpts {
  /** Soft ceiling for the serialized session, measured in UTF-8 BYTES — the same
   *  unit the Durable Object value cap uses. (The old code measured
   *  `JSON.stringify().length`, i.e. UTF-16 code units, so multibyte content —
   *  emoji, CJK, accents — could pass the estimate yet blow the real byte cap and
   *  freeze the session on save.) */
  softMaxBytes: number;
  /** write_file tool-call bodies longer than this are replaced with a placeholder. */
  toolCallMaxBytes: number;
}

const encoder = new TextEncoder();
/** UTF-8 byte length of a string — what the DO value cap actually counts. */
function byteLen(s: string): number {
  return encoder.encode(s).length;
}

/** Replace oversized write_file tool-call `content` with a placeholder in place. */
export function stripLargeToolCallBodies(messages: Message[], toolCallMaxBytes: number): void {
  for (const m of messages) {
    if (m.role !== "assistant" || !m.toolCalls) continue;
    for (const tc of m.toolCalls) {
      const content = tc.input?.content;
      if (tc.name === "write_file" && typeof content === "string" && content.length > toolCallMaxBytes) {
        const path = typeof tc.input.path === "string" ? tc.input.path : "file";
        tc.input = { ...tc.input, content: `[${content.length} bytes written to ${path}]` };
      }
    }
  }
}

/** Keep `session` under the storage budget. Returns the number of oldest
 *  messages trimmed (0 if it already fit). Never throws. */
export function enforceSessionBudget(session: { messages: Message[] }, opts: BudgetOpts): number {
  stripLargeToolCallBodies(session.messages, opts.toolCallMaxBytes);

  // Measure the WHOLE blob's UTF-8 byte size ONCE, then subtract each dropped
  // message's own serialized cost as we trim — instead of re-stringifying the
  // entire (up-to-2 MB) blob on every loop iteration, which was O(n²) on a long
  // transcript. Removing the head message shrinks the array by exactly that
  // message's JSON plus its one comma separator, so the running total stays exact.
  let trimmed = 0;
  let total = byteLen(JSON.stringify(session));
  while (session.messages.length > 1 && total > opts.softMaxBytes) {
    const removed = session.messages.shift()!;
    total -= byteLen(JSON.stringify(removed)) + 1; // +1 for the comma separator
    trimmed++;
  }

  // Trimming from the front can leave a `tool_result` whose originating
  // `tool_use` was trimmed — an orphaned tool_result at the head of the history
  // makes the provider reject the next turn with a 400 (tool_result without a
  // preceding tool_use), which would brick the session: the very failure this
  // budget guard exists to prevent. Drop any leading orphaned tool_results.
  while (session.messages.length > 1 && session.messages[0].role === "tool_result") {
    session.messages.shift();
    trimmed++;
  }
  return trimmed;
}
