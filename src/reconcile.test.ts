import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./index";

// Coverage for the reconcile heal path (Fix #2 + #3):
//  - the hourly cron (scheduled → heal=true) re-inserts missing routes and
//    deletes orphan routes, and touches NOTHING else (never archives a repo).
//  - a FAILED registry read heals nothing — a stale/empty read must never delete
//    a live route (the false-orphan trap).
//  - GET /api/reconcile stays report-only: it surfaces drift but mutates nothing.

afterEach(() => {
  vi.restoreAllMocks();
});

/** D1 mock that records every prepared SQL + its binds and answers the routes
 *  SELECT with the given slugs. */
function makeDB(routeSlugs: string[]) {
  const calls: { sql: string; binds: unknown[] }[] = [];
  const mk = (sql: string) => {
    let binds: unknown[] = [];
    const stmt: any = {
      bind: (...a: unknown[]) => { binds = a; return stmt; },
      run: async () => { calls.push({ sql, binds }); return {}; },
      all: async () => {
        calls.push({ sql, binds });
        if (/SELECT slug FROM routes/i.test(sql)) return { results: routeSlugs.map((s) => ({ slug: s })) };
        return { results: [] };
      },
      first: async () => ({ c: 0 }),
    };
    return stmt;
  };
  return { calls, db: { prepare: (sql: string) => mk(sql) } };
}

/** Global-fetch stub: answers the registry read (contents API or raw CDN) with
 *  `games`, or a 500 when `games` is null (simulating a total read failure). */
function registryFetch(games: unknown[] | null) {
  return async (input: unknown) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url.includes("/contents/registry.json") || url.includes("raw.githubusercontent")) {
      if (games === null) return new Response("upstream down", { status: 500 });
      return new Response(JSON.stringify({ games }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };
}

async function runScheduled(env: unknown) {
  const promises: Promise<unknown>[] = [];
  await worker.scheduled(
    {} as any,
    env as Parameters<typeof worker.scheduled>[1],
    { waitUntil: (p: Promise<unknown>) => promises.push(p) } as unknown as ExecutionContext,
  );
  await Promise.all(promises);
}

describe("reconcile heal (scheduled cron)", () => {
  it("re-inserts a missing route and deletes an orphan route, nothing else", async () => {
    // registry = {chess, tetris}; routes = {tetris, orphan}
    //   → missingRoute=[chess] (re-insert), orphanRoute=[orphan] (delete).
    vi.stubGlobal("fetch", registryFetch([{ id: "chess" }, { id: "tetris" }]));
    const { calls, db } = makeDB(["tetris", "orphan"]);
    const env = { GITHUB_TOKEN: "x", DB: db };
    await runScheduled(env);

    const routeInserts = calls.filter((c) => /INSERT INTO routes/i.test(c.sql));
    const routeDeletes = calls.filter((c) => /DELETE FROM routes/i.test(c.sql));
    expect(routeInserts.map((c) => c.binds[0])).toEqual(["chess"]);
    expect(routeDeletes.map((c) => c.binds[0])).toEqual(["orphan"]);
    // tetris (registry ∩ route) is left completely alone.
    expect(routeDeletes.some((c) => c.binds[0] === "tetris")).toBe(false);
  });

  it("heals NOTHING when the registry read fails (no false-orphan deletes)", async () => {
    vi.stubGlobal("fetch", registryFetch(null));
    const { calls, db } = makeDB(["chess", "tetris", "orphan"]);
    const env = { GITHUB_TOKEN: "x", DB: db };
    await runScheduled(env);

    expect(calls.filter((c) => /DELETE FROM routes/i.test(c.sql))).toHaveLength(0);
    expect(calls.filter((c) => /INSERT INTO routes/i.test(c.sql))).toHaveLength(0);
  });
});

describe("GET /api/reconcile is report-only", () => {
  it("reports drift but performs no route mutations", async () => {
    vi.stubGlobal("fetch", registryFetch([{ id: "chess" }]));
    const { calls, db } = makeDB(["orphan"]); // orphan route → drift
    const AUTH = {
      fetch: async () => new Response(JSON.stringify({ email: "serge.the.dev@gmail.com" }), { status: 200 }),
    };
    const env = {
      GITHUB_TOKEN: "x",
      DB: db,
      AUTH,
      ADMIN_EMAILS: "serge.the.dev@gmail.com",
    } as unknown as Parameters<typeof worker.fetch>[1];

    const res = await worker.fetch(
      new Request("https://admin.freegamestore.online/api/reconcile", { headers: { "X-FGS-Token": "t" } }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { drift: boolean; orphanRoute: string[]; healed?: unknown };
    expect(body.drift).toBe(true);
    expect(body.orphanRoute).toEqual(["orphan"]);
    expect(body.healed).toBeUndefined();
    // Read-only: no route was inserted or deleted.
    expect(calls.filter((c) => /INSERT INTO routes|DELETE FROM routes/i.test(c.sql))).toHaveLength(0);
  });
});
