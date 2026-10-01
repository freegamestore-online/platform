import { describe, expect, it } from "vitest";
import { activityFromDeployStatus, bumpSessionTokens, resolveUser, updateSessionActivity, upsertSessionIndex } from "./sessions";

/** Minimal D1 stub that records prepare/bind/run calls. */
function mockDb() {
  const calls: { sql: string; args: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            run: async () => {
              calls.push({ sql, args });
              return { success: true };
            },
          };
        },
        run: async () => {
          calls.push({ sql, args: [] });
          return { success: true };
        },
      };
    },
  };
  return { db: db as unknown as D1Database, calls };
}

const insertOf = (calls: { sql: string; args: unknown[] }[]) => calls.find((c) => c.sql.includes("INSERT INTO agent_sessions"));

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
    expect(insertOf(calls)!.args).toEqual(["user-1", "sess-1", "Beat Star", "beat-star", "https://beat-star.freegamestore.online", null]);
  });

  it("binds nulls for missing optional fields (COALESCE preserves existing)", async () => {
    const { db, calls } = mockDb();
    await upsertSessionIndex(db, "u", "s", {});
    expect(insertOf(calls)!.args).toEqual(["u", "s", null, null, null, null]);
  });
});

const updateOf = (calls: { sql: string; args: unknown[] }[]) => calls.find((c) => c.sql.includes("UPDATE agent_sessions SET input_tokens"));

describe("bumpSessionTokens", () => {
  it("no-ops when userId or sessionId is missing", async () => {
    const { db, calls } = mockDb();
    await bumpSessionTokens(db, "", "s", 10, 20);
    await bumpSessionTokens(db, "u", "", 10, 20);
    expect(updateOf(calls)).toBeUndefined();
  });

  it("writes rounded, non-negative absolute totals bound to the user+session", async () => {
    const { db, calls } = mockDb();
    await bumpSessionTokens(db, "user-1", "sess-1", 1234.6, -5);
    expect(updateOf(calls)!.args).toEqual([1235, 0, "user-1", "sess-1"]);
  });
});

const activityUpdateOf = (calls: { sql: string; args: unknown[] }[]) =>
  calls.find((c) => c.sql.includes("activity_phase = excluded.activity_phase"));

describe("updateSessionActivity", () => {
  it("no-ops when userId or sessionId is missing", async () => {
    const { db, calls } = mockDb();
    await updateSessionActivity(db, "", "s", { phase: "writing", detail: "Writing" });
    await updateSessionActivity(db, "u", "", { phase: "writing", detail: "Writing" });
    expect(activityUpdateOf(calls)).toBeUndefined();
  });

  it("writes the latest activity for a session", async () => {
    const { db, calls } = mockDb();
    await updateSessionActivity(db, "user-1", "sess-1", { phase: "building", detail: "Building and deploying" });
    expect(activityUpdateOf(calls)!.args).toEqual(["user-1", "sess-1", "building", "Building and deploying"]);
  });
});

describe("activityFromDeployStatus", () => {
  it("maps deploy phases to list activity", () => {
    expect(activityFromDeployStatus({ phase: "pushing", progress: "x" })).toEqual({ phase: "pushing", detail: "Pushing code" });
    expect(activityFromDeployStatus({ phase: "live", appUrl: "https://x" })).toEqual({ phase: "live", detail: "Live" });
    expect(activityFromDeployStatus({ phase: "error", error: "boom" })).toEqual({ phase: "error", detail: "boom" });
  });
});

describe("resolveUser /me audience (#69)", () => {
  it("accepts only agent- or MCP-issued sessions", async () => {
    const seen: Headers[] = [];
    const auth = {
      fetch: async (_u: unknown, init?: RequestInit) => {
        seen.push(new Headers(init?.headers));
        return new Response(JSON.stringify({ id: "github:1", name: "Octo", login: "octo" }));
      },
    } as unknown as Fetcher;
    const user = await resolveUser(new Request("https://agent.test/sessions", { headers: { "X-FGS-Token": "tok" } }), auth);
    expect(user?.login).toBe("octo");
    expect(seen[0]?.get("X-FGS-Audience")).toBe("https://agent.freegamestore.online,https://mcp.freegamestore.online");
  });
});
