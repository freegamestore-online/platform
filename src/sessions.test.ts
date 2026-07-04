import { describe, it, expect } from "vitest";
import { upsertSessionIndex } from "./sessions";

/** Minimal D1 stub that records prepare/bind/run calls. */
function mockDb() {
  const calls: { sql: string; args: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return { run: async () => { calls.push({ sql, args }); return { success: true }; } };
        },
        run: async () => { calls.push({ sql, args: [] }); return { success: true }; },
      };
    },
  };
  return { db: db as unknown as D1Database, calls };
}

const insertOf = (calls: { sql: string; args: unknown[] }[]) =>
  calls.find((c) => c.sql.includes("INSERT INTO agent_sessions"));

describe("upsertSessionIndex", () => {
  it("no-ops (no DB writes) when userId or sessionId is missing", async () => {
    const { db, calls } = mockDb();
    await upsertSessionIndex(db, "", "sess-1", { title: "x" });
    await upsertSessionIndex(db, "user-1", "", { title: "x" });
    expect(insertOf(calls)).toBeUndefined();
  });

  it("upserts the row with the session's fields", async () => {
    const { db, calls } = mockDb();
    await upsertSessionIndex(db, "user-1", "sess-1", {
      title: "Beat Star",
      gameId: "beat-star",
      gameUrl: "https://beat-star.freegamestore.online",
    });
    expect(insertOf(calls)!.args).toEqual([
      "user-1",
      "sess-1",
      "Beat Star",
      "beat-star",
      "https://beat-star.freegamestore.online",
    ]);
  });

  it("binds nulls for missing optional fields (COALESCE preserves existing)", async () => {
    const { db, calls } = mockDb();
    await upsertSessionIndex(db, "u", "s", {});
    expect(insertOf(calls)!.args).toEqual(["u", "s", null, null, null]);
  });
});
