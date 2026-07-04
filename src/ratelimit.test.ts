import { describe, expect, it } from "vitest";
import { allowRequest } from "./ratelimit";

/** In-memory D1 stub: models the INSERT … ON CONFLICT … RETURNING count upsert. */
function mockDb() {
  const counts = new Map<string, number>();
  const db = {
    prepare(sql: string) {
      return {
        run: async () => ({ success: true }), // schema DDL
        bind(...args: unknown[]) {
          return {
            run: async () => ({ success: true }), // prune DELETE
            first: async <T>() => {
              if (sql.includes("INSERT INTO rate_limits")) {
                const bucket = String(args[0]);
                const n = (counts.get(bucket) ?? 0) + 1;
                counts.set(bucket, n);
                return { count: n } as unknown as T;
              }
              return null as unknown as T;
            },
          };
        },
      };
    },
  };
  return { db: db as unknown as D1Database };
}

describe("allowRequest", () => {
  it("allows up to the limit, then blocks within the same window", async () => {
    const { db } = mockDb();
    const out: boolean[] = [];
    for (let i = 0; i < 5; i++) out.push(await allowRequest(db, "k", 3, 3600, 1000));
    expect(out).toEqual([true, true, true, false, false]);
  });

  it("resets in the next window", async () => {
    const { db } = mockDb();
    expect(await allowRequest(db, "k", 1, 100, 50)).toBe(true);
    expect(await allowRequest(db, "k", 1, 100, 50)).toBe(false); // same window
    expect(await allowRequest(db, "k", 1, 100, 150)).toBe(true); // next window
  });

  it("counts keys independently", async () => {
    const { db } = mockDb();
    expect(await allowRequest(db, "a", 1, 100, 0)).toBe(true);
    expect(await allowRequest(db, "b", 1, 100, 0)).toBe(true);
  });

  it("fails OPEN on a DB error (never takes down the guarded feature)", async () => {
    const db = { prepare() { throw new Error("boom"); } } as unknown as D1Database;
    expect(await allowRequest(db, "k", 1, 100, 0)).toBe(true);
  });
});
