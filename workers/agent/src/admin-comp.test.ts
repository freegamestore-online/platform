import { afterEach, describe, expect, it, vi } from "vitest";
import { handleAdminCompApi } from "./admin-comp";

// GET /v1/admin/sessions pagination (#25). Before this the handler returned a
// flat `LIMIT 500` list, which silently truncated the fleet with no signal that
// anything was missing, and the admin proxy dropped query params so no caller
// could have asked for more anyway.

/** D1 stub over a fixed row set: answers the COUNT and the paged SELECT, and
 *  records the LIMIT/OFFSET it was actually given. */
function makeDB(rowCount: number) {
  const binds: unknown[][] = [];
  const rows = Array.from({ length: rowCount }, (_, i) => ({
    user_id: `github:${i}`,
    user_login: `user${i}`,
    session_id: `sess-${i}`,
    title: `Session ${i}`,
    game_id: `game-${i}`,
    game_url: null,
    deployed: 0,
    input_tokens: 0,
    output_tokens: 0,
    activity_phase: "idle",
    activity_detail: null,
    activity_updated_at: null,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  }));
  const db: any = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt: any = {
        bind: (...a: unknown[]) => { bound = a; return stmt; },
        run: async () => ({}),
        first: async () => (/COUNT\(\*\)/i.test(sql) ? { n: rowCount } : null),
        all: async () => {
          if (/FROM agent_sessions/i.test(sql) && /LIMIT/i.test(sql)) {
            binds.push(bound);
            const [limit, offset] = bound as [number, number];
            return { results: rows.slice(offset, offset + limit) };
          }
          return { results: [] };
        },
      };
      return stmt;
    },
  };
  return { db, binds };
}

const env = (db: any) => ({ DB: db, INTERNAL_TOKEN: "secret" }) as any;
const cors = {};

const get = (url: string, db: any, token = "secret") =>
  handleAdminCompApi(new Request(url, { headers: { "X-Internal-Token": token } }), env(db), cors);

afterEach(() => vi.restoreAllMocks());

describe("GET /v1/admin/sessions pagination", () => {
  it("returns the first page with a next cursor and the true total", async () => {
    const { db, binds } = makeDB(50);
    const res = await get("https://agent/v1/admin/sessions", db);
    const body = (await res!.json()) as any;

    expect(body.sessions).toHaveLength(20); // default page size
    expect(body.total).toBe(50);
    expect(body.next_cursor).toBe("20");
    expect(binds[0]).toEqual([20, 0]);
    expect(body.sessions[0].id).toBe("sess-0");
  });

  it("follows a cursor to the next page without repeating rows", async () => {
    const { db, binds } = makeDB(50);
    const res = await get("https://agent/v1/admin/sessions?cursor=20", db);
    const body = (await res!.json()) as any;

    expect(binds[0]).toEqual([20, 20]);
    expect(body.sessions[0].id).toBe("sess-20");
    expect(body.next_cursor).toBe("40");
  });

  it("returns next_cursor null on the last page", async () => {
    const { db } = makeDB(50);
    const body = (await (await get("https://agent/v1/admin/sessions?cursor=40", db))!.json()) as any;
    expect(body.sessions).toHaveLength(10);
    // Null rather than an offset past the end, so a caller can loop until null
    // instead of comparing counts itself.
    expect(body.next_cursor).toBeNull();
  });

  it("clamps limit to the 100 maximum", async () => {
    const { db, binds } = makeDB(500);
    const body = (await (await get("https://agent/v1/admin/sessions?limit=1000", db))!.json()) as any;
    expect(binds[0]![0]).toBe(100);
    expect(body.sessions).toHaveLength(100);
  });

  it("honours a smaller explicit limit", async () => {
    const { db, binds } = makeDB(50);
    const body = (await (await get("https://agent/v1/admin/sessions?limit=5", db))!.json()) as any;
    expect(binds[0]).toEqual([5, 0]);
    expect(body.sessions).toHaveLength(5);
    expect(body.next_cursor).toBe("5");
  });

  it("rejects a malformed cursor instead of silently restarting at page 1", async () => {
    // Quietly treating garbage as offset 0 would make a paging bug look like
    // duplicated rows rather than an error.
    const { db } = makeDB(50);
    for (const bad of ["abc", "-1", "1.5"]) {
      const res = await get(`https://agent/v1/admin/sessions?cursor=${bad}`, db);
      expect(res!.status).toBe(400);
    }
  });

  it("rejects a non-positive or non-numeric limit", async () => {
    const { db } = makeDB(50);
    for (const bad of ["0", "-5", "abc"]) {
      const res = await get(`https://agent/v1/admin/sessions?limit=${bad}`, db);
      expect(res!.status).toBe(400);
    }
  });

  it("handles an empty table without offering a cursor", async () => {
    const { db } = makeDB(0);
    const body = (await (await get("https://agent/v1/admin/sessions", db))!.json()) as any;
    expect(body.sessions).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.next_cursor).toBeNull();
  });

  it("still requires the internal token (or an org admin)", async () => {
    const { db } = makeDB(5);
    // No AUTH binding is provided, so the org-admin fallback cannot succeed.
    const res = await handleAdminCompApi(
      new Request("https://agent/v1/admin/sessions"),
      { DB: db, INTERNAL_TOKEN: "secret", AUTH: { fetch: async () => new Response("no", { status: 401 }) } } as any,
      cors,
    );
    expect(res!.status).toBe(403);
  });
});
