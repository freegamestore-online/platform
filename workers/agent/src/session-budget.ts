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
import { looksLikePlaceholder } from "./tools";

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

/**
 * Marker that replaces an elided write_file body in the transcript. It is
 * deliberately INSTRUCTIONAL, not content-shaped: the previous marker
 * ("[N bytes written to path]") read like a plausible terse value, so on the next
 * turn the model imitated its own history and wrote that string AS the file's
 * content — poisoning the session into an endless placeholder loop (the angrry
 * incident). This phrasing reads as a system note the model won't reproduce, and
 * if it ever does, `looksLikePlaceholder` (tools.ts) rejects it. Keep the two in
 * sync. Exported so the history-healer can normalize old poisoned sessions to it.
 */
export function elidedBodyMarker(path: string): string {
  return `[the full source of ${path} is already saved — omitted here to save space. To view it call read_file; to edit it output the COMPLETE real code. Never write this note as file content.]`;
}

/**
 * Heal a poisoned transcript, returning a NEW cleaned message list to send to the
 * model. A write_file tool call whose `content` is a content-shaped placeholder —
 * the compaction marker, or any echo the model wrote — must NEVER be fed back: the
 * model imitates whatever content value it sees in its own history, so replacing
 * one placeholder with another just makes it copy the new one (the angrry loop
 * kept going even after we swapped markers). The only safe move is to remove the
 * poisoned write turn entirely and leave a plain-TEXT breadcrumb — text can't be
 * mistaken for a file body, and the real file is still in the project (read_file).
 * The paired tool_result is dropped with it so tool_use/tool_result stays balanced.
 */
export function healPoisonedHistory(messages: Message[]): Message[] {
  const out: Message[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const poisoned =
      m.role === "assistant" &&
      m.toolCalls?.some(
        (tc) => tc.name === "write_file" && typeof tc.input?.content === "string" && looksLikePlaceholder(tc.input.content),
      );
    if (poisoned && m.toolCalls) {
      const paths = [
        ...new Set(
          m.toolCalls.filter((tc) => tc.name === "write_file").map((tc) => (typeof tc.input?.path === "string" ? tc.input.path : "a file")),
        ),
      ];
      out.push({
        role: "assistant",
        content: `(Earlier I created/updated ${paths.join(", ")}. Use read_file to see the current contents before editing — do not guess.)`,
      });
      // Skip the paired tool_result that immediately follows (cleaned history
      // keeps tool_use and its tool_result adjacent), so nothing is orphaned.
      if (messages[i + 1]?.role === "tool_result") i++;
      continue;
    }
    out.push(m);
  }
  return out;
}

/** Fit the LIVE turn context under a total char budget (free-tier request
 *  caps). Clone-safe like stripLargeToolCallBodies: array slots are replaced,
 *  the original message objects (shared with newMessages/storage) are never
 *  mutated. Order: elide big write bodies → clamp big tool results → drop
 *  oldest messages (keeping tool_use/tool_result pairs intact). */
export function fitLiveContext(messages: Message[], maxChars: number): void {
  stripLargeToolCallBodies(messages, 2000);

  const size = (m: Message): number =>
    (m.content?.length || 0) +
    (m.toolCalls ? JSON.stringify(m.toolCalls).length : 0) +
    (m.toolResults ? JSON.stringify(m.toolResults).length : 0);

  let total = messages.reduce((n, m) => n + size(m), 0);
  if (total <= maxChars) return;

  // Clamp oversized tool results (cloned).
  for (let i = 0; i < messages.length && total > maxChars; i++) {
    const m = messages[i]!;
    if (m.role !== "tool_result" || !m.toolResults) continue;
    if (!m.toolResults.some((tr) => tr.content.length > 2000)) continue;
    const before = size(m);
    messages[i] = {
      ...m,
      toolResults: m.toolResults.map((tr) =>
        tr.content.length > 2000 ? { ...tr, content: `${tr.content.slice(0, 2000)}\n… [trimmed to fit the free-tier context]` } : tr,
      ),
    };
    total += size(messages[i]!) - before;
  }

  // Drop oldest messages, never splitting a tool_use/tool_result pair and
  // never dropping the final (current) user message.
  while (total > maxChars && messages.length > 2) {
    const first = messages[0]!;
    const dropPair = first.role === "assistant" && first.toolCalls?.length && messages[1]?.role === "tool_result";
    const dropped = dropPair ? messages.splice(0, 2) : messages.splice(0, 1);
    total -= dropped.reduce((n, m) => n + size(m), 0);
  }
  // A leading orphaned tool_result 400s the provider — drop it.
  while (messages.length > 1 && messages[0]!.role === "tool_result") {
    total -= size(messages[0]!);
    messages.shift();
  }
}

/** Replace oversized write_file tool-call `content` with a placeholder.
 *
 * CLONES the affected message (and its toolCalls) instead of mutating in
 * place. The message objects in `session.messages` are SHARED with the live
 * turn's in-flight context (the per-message checkpoint persists the same
 * references) — the old in-place swap leaked this storage-only marker into
 * the model's OWN working context mid-turn, right after a successful big
 * write. The model then imitated the marker as the next file's content and
 * every subsequent write was rejected by the placeholder guard (the
 * flappyslaybird 2026-07-11 loop). Only the array slot is replaced; the
 * turn's separate message arrays keep the original full-content objects. */
export function stripLargeToolCallBodies(messages: Message[], toolCallMaxBytes: number): void {
  const oversized = (tc: Message["toolCalls"] extends (infer T)[] | undefined ? T : never): boolean =>
    tc.name === "write_file" && typeof tc.input?.content === "string" && tc.input.content.length > toolCallMaxBytes;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.role !== "assistant" || !m.toolCalls || !m.toolCalls.some(oversized)) continue;
    messages[i] = {
      ...m,
      toolCalls: m.toolCalls.map((tc) =>
        oversized(tc)
          ? { ...tc, input: { ...tc.input, content: elidedBodyMarker(typeof tc.input.path === "string" ? tc.input.path : "file") } }
          : tc,
      ),
    };
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
