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

// Build-status backstop (#22). The agent reports a CI outcome the moment it sees
// one, but it is not the only publisher — the CLI and MCP provision without it,
// and an agent run that dies mid-deploy never reports at all. Without this sweep
// those games sit `pending` forever and are hidden from the store.

/** Registry read/write + Actions stub. `runs` maps a game id to the conclusion
 *  its latest deploy.yml run reports (undefined → nothing concluded yet). */
function statusFetch(
  games: unknown[],
  runs: Record<string, "success" | "failure" | "cancelled" | undefined>,
) {
  const puts: Array<any[]> = [];
  const actionsQueried: string[] = [];
  const fetchFn = async (
    input: unknown,
    init?: { method?: string; body?: string; headers?: Record<string, string> },
  ) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    const method = init?.method ?? "GET";
    const actions = /\/repos\/[^/]+\/([^/]+)\/actions\/workflows\/deploy\.yml\/runs/.exec(url);
    if (actions) {
      const id = actions[1]!;
      actionsQueried.push(id);
      const conclusion = runs[id];
      return new Response(
        JSON.stringify({
          workflow_runs: conclusion ? [{ status: "completed", conclusion }] : [],
        }),
        { status: 200 },
      );
    }
    if (url.includes("/contents/registry.json")) {
      if (method === "GET") {
        // Same URL, two shapes: fetchRegistryItems asks for the RAW body
        // (Accept: …raw+json) while publish.ts's ghApi takes the default
        // base64-wrapped contents payload. Answer whichever was asked for.
        const raw = (init?.headers?.Accept ?? "").includes("raw");
        return new Response(
          raw
            ? JSON.stringify({ games })
            : JSON.stringify({ content: btoa(JSON.stringify({ games })), sha: "sha1" }),
          { status: 200 },
        );
      }
      puts.push(JSON.parse(atob(JSON.parse(init!.body!).content)).games);
      return new Response(JSON.stringify({ content: { sha: "sha2" } }), { status: 200 });
    }
    if (url.includes("raw.githubusercontent")) {
      return new Response(JSON.stringify({ games }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };
  return { puts, actionsQueried, fetchFn };
}

describe("reconcile build-status backstop", () => {
  it("flips a pending game whose deploy concluded success to live", async () => {
    const { puts, fetchFn } = statusFetch(
      [{ id: "chess", status: "pending" }],
      { chess: "success" },
    );
    vi.stubGlobal("fetch", fetchFn);
    const { db } = makeDB(["chess"]);
    await runScheduled({ GITHUB_TOKEN: "x", DB: db });

    expect(puts).toHaveLength(1);
    expect(puts[0]!.find((g: any) => g.id === "chess").status).toBe("live");
  });

  it("flips a pending game whose deploy failed to failed", async () => {
    const { puts, fetchFn } = statusFetch(
      [{ id: "chess", status: "pending" }],
      { chess: "failure" },
    );
    vi.stubGlobal("fetch", fetchFn);
    const { db } = makeDB(["chess"]);
    await runScheduled({ GITHUB_TOKEN: "x", DB: db });

    expect(puts[0]!.find((g: any) => g.id === "chess").status).toBe("failed");
  });

  it("leaves a pending game alone while nothing has concluded", async () => {
    const { puts, fetchFn } = statusFetch([{ id: "chess", status: "pending" }], {});
    vi.stubGlobal("fetch", fetchFn);
    const { db } = makeDB(["chess"]);
    await runScheduled({ GITHUB_TOKEN: "x", DB: db });

    expect(puts).toHaveLength(0);
  });

  it("ignores a cancelled run — Path B cancels superseded runs by design", async () => {
    const { puts, fetchFn } = statusFetch(
      [{ id: "chess", status: "pending" }],
      { chess: "cancelled" },
    );
    vi.stubGlobal("fetch", fetchFn);
    const { db } = makeDB(["chess"]);
    await runScheduled({ GITHUB_TOKEN: "x", DB: db });

    expect(puts).toHaveLength(0);
  });

  it("never queries or rewrites a game that is already live or legacy", async () => {
    const { puts, actionsQueried, fetchFn } = statusFetch(
      [{ id: "chess", status: "live" }, { id: "tetris" }],
      { chess: "failure", tetris: "failure" },
    );
    vi.stubGlobal("fetch", fetchFn);
    const { db } = makeDB(["chess", "tetris"]);
    await runScheduled({ GITHUB_TOKEN: "x", DB: db });

    expect(actionsQueried).toHaveLength(0);
    expect(puts).toHaveLength(0);
  });

  it("resolves several pending games in ONE registry commit", async () => {
    const { puts, fetchFn } = statusFetch(
      [
        { id: "a", status: "pending" },
        { id: "b", status: "pending" },
        { id: "c", status: "pending" },
      ],
      { a: "success", b: "failure", c: undefined },
    );
    vi.stubGlobal("fetch", fetchFn);
    const { db } = makeDB(["a", "b", "c"]);
    await runScheduled({ GITHUB_TOKEN: "x", DB: db });

    expect(puts).toHaveLength(1);
    expect(puts[0]!.find((g: any) => g.id === "a").status).toBe("live");
    expect(puts[0]!.find((g: any) => g.id === "b").status).toBe("failed");
    expect(puts[0]!.find((g: any) => g.id === "c").status).toBe("pending");
  });

  it("GET /api/reconcile reports pending but flips nothing", async () => {
    const { puts, actionsQueried, fetchFn } = statusFetch(
      [{ id: "chess", status: "pending" }],
      { chess: "success" },
    );
    vi.stubGlobal("fetch", fetchFn);
    const { db } = makeDB(["chess"]);
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
    const body = (await res.json()) as { pending: string[] };
    expect(body.pending).toEqual(["chess"]);
    expect(actionsQueried).toHaveLength(0);
    expect(puts).toHaveLength(0);
  });
});
