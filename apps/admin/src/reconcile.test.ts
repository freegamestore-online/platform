import { afterEach, describe, expect, it, vi } from 'vitest';
import { ERROR_LOG_LIMITS } from '../../../contracts/error-log/v1/contract';
import { reportPlatformError } from '../../../workers/agent/src/errlog';
import worker from './index';

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
      bind: (...a: unknown[]) => {
        binds = a;
        return stmt;
      },
      run: async () => {
        calls.push({ sql, binds });
        return {};
      },
      all: async () => {
        calls.push({ sql, binds });
        if (/SELECT slug FROM routes/i.test(sql))
          return { results: routeSlugs.map((s) => ({ slug: s })) };
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
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (url.includes('/contents/registry.json') || url.includes('raw.githubusercontent')) {
      if (games === null) return new Response('upstream down', { status: 500 });
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

describe('reconcile heal (scheduled cron)', () => {
  it('re-inserts a missing route and deletes an orphan route, nothing else', async () => {
    // registry = {chess, tetris}; routes = {tetris, orphan}
    //   → missingRoute=[chess] (re-insert), orphanRoute=[orphan] (delete).
    vi.stubGlobal('fetch', registryFetch([{ id: 'chess' }, { id: 'tetris' }]));
    const { calls, db } = makeDB(['tetris', 'orphan']);
    const env = { GITHUB_TOKEN: 'x', DB: db };
    await runScheduled(env);

    const routeInserts = calls.filter((c) => /INSERT INTO routes/i.test(c.sql));
    const routeDeletes = calls.filter((c) => /DELETE FROM routes/i.test(c.sql));
    expect(routeInserts.map((c) => c.binds[0])).toEqual(['chess']);
    expect(routeDeletes.map((c) => c.binds[0])).toEqual(['orphan']);
    // tetris (registry ∩ route) is left completely alone.
    expect(routeDeletes.some((c) => c.binds[0] === 'tetris')).toBe(false);
  });

  it('heals NOTHING when the registry read fails (no false-orphan deletes)', async () => {
    vi.stubGlobal('fetch', registryFetch(null));
    const { calls, db } = makeDB(['chess', 'tetris', 'orphan']);
    const env = { GITHUB_TOKEN: 'x', DB: db };
    await runScheduled(env);

    expect(calls.filter((c) => /DELETE FROM routes/i.test(c.sql))).toHaveLength(0);
    expect(calls.filter((c) => /INSERT INTO routes/i.test(c.sql))).toHaveLength(0);
  });
});

describe('GET /api/reconcile is report-only', () => {
  it('reports drift but performs no route mutations', async () => {
    vi.stubGlobal('fetch', registryFetch([{ id: 'chess' }]));
    const { calls, db } = makeDB(['orphan']); // orphan route → drift
    const AUTH = {
      fetch: async () =>
        new Response(JSON.stringify({ email: 'serge.the.dev@gmail.com' }), { status: 200 }),
    };
    const env = {
      GITHUB_TOKEN: 'x',
      DB: db,
      AUTH,
      ADMIN_EMAILS: 'serge.the.dev@gmail.com',
    } as unknown as Parameters<typeof worker.fetch>[1];

    const res = await worker.fetch(
      new Request('https://admin.freegamestore.online/api/reconcile', {
        headers: { 'X-FGS-Token': 't' },
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { drift: boolean; orphanRoute: string[]; healed?: unknown };
    expect(body.drift).toBe(true);
    expect(body.orphanRoute).toEqual(['orphan']);
    expect(body.healed).toBeUndefined();
    // Read-only: no route was inserted or deleted.
    expect(calls.filter((c) => /INSERT INTO routes|DELETE FROM routes/i.test(c.sql))).toHaveLength(
      0,
    );
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
  runs: Record<string, 'success' | 'failure' | 'cancelled' | undefined>,
) {
  const puts: Array<any[]> = [];
  const actionsQueried: string[] = [];
  const fetchFn = async (
    input: unknown,
    init?: { method?: string; body?: string; headers?: Record<string, string> },
  ) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    const method = init?.method ?? 'GET';
    const actions = /\/repos\/[^/]+\/([^/]+)\/actions\/workflows\/deploy\.yml\/runs/.exec(url);
    if (actions) {
      const id = actions[1]!;
      actionsQueried.push(id);
      const conclusion = runs[id];
      return new Response(
        JSON.stringify({
          workflow_runs: conclusion ? [{ status: 'completed', conclusion }] : [],
        }),
        { status: 200 },
      );
    }
    if (url.includes('/contents/registry.json')) {
      if (method === 'GET') {
        // Same URL, two shapes: fetchRegistryItems asks for the RAW body
        // (Accept: …raw+json) while publish.ts's ghApi takes the default
        // base64-wrapped contents payload. Answer whichever was asked for.
        const raw = (init?.headers?.Accept ?? '').includes('raw');
        return new Response(
          raw
            ? JSON.stringify({ games })
            : JSON.stringify({ content: btoa(JSON.stringify({ games })), sha: 'sha1' }),
          { status: 200 },
        );
      }
      puts.push(JSON.parse(atob(JSON.parse(init!.body!).content)).games);
      return new Response(JSON.stringify({ content: { sha: 'sha2' } }), { status: 200 });
    }
    if (url.includes('raw.githubusercontent')) {
      return new Response(JSON.stringify({ games }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };
  return { puts, actionsQueried, fetchFn };
}

describe('reconcile build-status backstop', () => {
  it('flips a pending game whose deploy concluded success to live', async () => {
    const { puts, fetchFn } = statusFetch([{ id: 'chess', status: 'pending' }], {
      chess: 'success',
    });
    vi.stubGlobal('fetch', fetchFn);
    const { db } = makeDB(['chess']);
    await runScheduled({ GITHUB_TOKEN: 'x', DB: db });

    expect(puts).toHaveLength(1);
    expect(puts[0]!.find((g: any) => g.id === 'chess').status).toBe('live');
  });

  it('flips a pending game whose deploy failed to failed', async () => {
    const { puts, fetchFn } = statusFetch([{ id: 'chess', status: 'pending' }], {
      chess: 'failure',
    });
    vi.stubGlobal('fetch', fetchFn);
    const { db } = makeDB(['chess']);
    await runScheduled({ GITHUB_TOKEN: 'x', DB: db });

    expect(puts[0]!.find((g: any) => g.id === 'chess').status).toBe('failed');
  });

  it('leaves a pending game alone while nothing has concluded', async () => {
    const { puts, fetchFn } = statusFetch([{ id: 'chess', status: 'pending' }], {});
    vi.stubGlobal('fetch', fetchFn);
    const { db } = makeDB(['chess']);
    await runScheduled({ GITHUB_TOKEN: 'x', DB: db });

    expect(puts).toHaveLength(0);
  });

  it('ignores a cancelled run — Path B cancels superseded runs by design', async () => {
    const { puts, fetchFn } = statusFetch([{ id: 'chess', status: 'pending' }], {
      chess: 'cancelled',
    });
    vi.stubGlobal('fetch', fetchFn);
    const { db } = makeDB(['chess']);
    await runScheduled({ GITHUB_TOKEN: 'x', DB: db });

    expect(puts).toHaveLength(0);
  });

  it('never queries or rewrites a game that is already live or legacy', async () => {
    const { puts, actionsQueried, fetchFn } = statusFetch(
      [{ id: 'chess', status: 'live' }, { id: 'tetris' }],
      { chess: 'failure', tetris: 'failure' },
    );
    vi.stubGlobal('fetch', fetchFn);
    const { db } = makeDB(['chess', 'tetris']);
    await runScheduled({ GITHUB_TOKEN: 'x', DB: db });

    expect(actionsQueried).toHaveLength(0);
    expect(puts).toHaveLength(0);
  });

  it('resolves several pending games in ONE registry commit', async () => {
    const { puts, fetchFn } = statusFetch(
      [
        { id: 'a', status: 'pending' },
        { id: 'b', status: 'pending' },
        { id: 'c', status: 'pending' },
      ],
      { a: 'success', b: 'failure', c: undefined },
    );
    vi.stubGlobal('fetch', fetchFn);
    const { db } = makeDB(['a', 'b', 'c']);
    await runScheduled({ GITHUB_TOKEN: 'x', DB: db });

    expect(puts).toHaveLength(1);
    expect(puts[0]!.find((g: any) => g.id === 'a').status).toBe('live');
    expect(puts[0]!.find((g: any) => g.id === 'b').status).toBe('failed');
    expect(puts[0]!.find((g: any) => g.id === 'c').status).toBe('pending');
  });

  it('GET /api/reconcile reports pending but flips nothing', async () => {
    const { puts, actionsQueried, fetchFn } = statusFetch([{ id: 'chess', status: 'pending' }], {
      chess: 'success',
    });
    vi.stubGlobal('fetch', fetchFn);
    const { db } = makeDB(['chess']);
    const AUTH = {
      fetch: async () =>
        new Response(JSON.stringify({ email: 'serge.the.dev@gmail.com' }), { status: 200 }),
    };
    const env = {
      GITHUB_TOKEN: 'x',
      DB: db,
      AUTH,
      ADMIN_EMAILS: 'serge.the.dev@gmail.com',
    } as unknown as Parameters<typeof worker.fetch>[1];

    const res = await worker.fetch(
      new Request('https://admin.freegamestore.online/api/reconcile', {
        headers: { 'X-FGS-Token': 't' },
      }),
      env,
    );
    const body = (await res.json()) as { pending: string[] };
    expect(body.pending).toEqual(['chess']);
    expect(actionsQueried).toHaveLength(0);
    expect(puts).toHaveLength(0);
  });
});

// POST /api/internal/error (#21) — the agent cannot INSERT into error_log itself
// (its DB binding is the leaderboard database; error_log lives in admin's
// freegamestore database), so it reports over the service binding instead.

describe('POST /api/internal/error', () => {
  function envWithDb() {
    const inserts: { sql: string; binds: unknown[] }[] = [];
    const mk = (sql: string) => {
      let binds: unknown[] = [];
      const stmt: any = {
        bind: (...a: unknown[]) => {
          binds = a;
          return stmt;
        },
        run: async () => {
          inserts.push({ sql, binds });
          return {};
        },
        all: async () => ({ results: [] }),
        first: async () => ({ c: 0 }),
      };
      return stmt;
    };
    return {
      inserts,
      env: { INTERNAL_TOKEN: 'secret', DB: { prepare: (sql: string) => mk(sql) } } as any,
    };
  }

  const post = (env: any, body: unknown, token?: string) =>
    worker.fetch(
      new Request('https://admin.freegamestore.online/api/internal/error', {
        method: 'POST',
        headers: token
          ? { 'X-Internal-Token': token, 'Content-Type': 'application/json' }
          : { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      env,
    );

  it('writes an agent/deploy row into error_log', async () => {
    const { inserts, env } = envWithDb();
    const res = await post(
      env,
      {
        source: 'agent/deploy',
        user: 'u1',
        context: 'gameId=candy-shop sessionId=s1',
        message: 'Deploy workflow failure: deploy › Smoke test built game',
      },
      'secret',
    );

    expect(res.status).toBe(200);
    const insert = inserts.find((i) => /INSERT INTO error_log/i.test(i.sql));
    expect(insert).toBeDefined();
    expect(insert!.binds[0]).toBe('agent/deploy');
    expect(insert!.binds[1]).toBe('u1');
    expect(insert!.binds[2]).toContain('gameId=candy-shop');
    expect(String(insert!.binds[3])).toContain('Smoke test built game');
  });

  it('rejects a caller without the internal token', async () => {
    const { inserts, env } = envWithDb();
    const res = await post(env, { source: 'agent/deploy', message: 'x' });
    expect(res.status).toBe(401);
    // error_log backs operator triage — an unauthenticated caller must not be
    // able to write into it at all.
    expect(inserts.filter((i) => /INSERT INTO error_log/i.test(i.sql))).toHaveLength(0);
  });

  it('rejects a wrong internal token', async () => {
    const { inserts, env } = envWithDb();
    const res = await post(env, { source: 'agent/deploy', message: 'x' }, 'not-the-token');
    expect(res.status).toBe(401);
    expect(inserts.filter((i) => /INSERT INTO error_log/i.test(i.sql))).toHaveLength(0);
  });

  it('requires both source and message', async () => {
    const { inserts, env } = envWithDb();
    expect((await post(env, { message: 'x' }, 'secret')).status).toBe(400);
    expect((await post(env, { source: 'agent/deploy' }, 'secret')).status).toBe(400);
    expect((await post(env, { source: '  ', message: 'x' }, 'secret')).status).toBe(400);
    expect(inserts.filter((i) => /INSERT INTO error_log/i.test(i.sql))).toHaveLength(0);
  });

  it('normalises non-string optional fields to null instead of persisting junk', async () => {
    const { inserts, env } = envWithDb();
    const res = await post(
      env,
      { source: 'agent/deploy', message: 'boom', user: 42, context: {} },
      'secret',
    );
    expect(res.status).toBe(200);
    const insert = inserts.find((i) => /INSERT INTO error_log/i.test(i.sql))!;
    expect(insert.binds[1]).toBeNull();
    expect(insert.binds[2]).toBeNull();
  });

  it('accepts the agent reporter contract through the real internal endpoint', async () => {
    const { inserts, env } = envWithDb();
    const ADMIN = {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        worker.fetch(new Request(input, init), env),
    } as unknown as Fetcher;

    await reportPlatformError({ ADMIN, INTERNAL_TOKEN: 'secret' }, 'freegamestore.online', {
      source: 'a'.repeat(ERROR_LOG_LIMITS.source + 1),
      user: 'u'.repeat(ERROR_LOG_LIMITS.user + 1),
      context: 'c'.repeat(ERROR_LOG_LIMITS.context + 1),
      message: 'm'.repeat(ERROR_LOG_LIMITS.message + 1),
      stack: 's'.repeat(ERROR_LOG_LIMITS.stack + 1),
    });

    const insert = inserts.find((entry) => /INSERT INTO error_log/i.test(entry.sql));
    expect(insert?.binds.map((value) => String(value).length)).toEqual([
      ERROR_LOG_LIMITS.source,
      ERROR_LOG_LIMITS.user,
      ERROR_LOG_LIMITS.context,
      ERROR_LOG_LIMITS.message,
      ERROR_LOG_LIMITS.stack,
    ]);
  });
});

// GET /api/status must carry the build status through to the console (#22).
// fetchRegistry maps registry entries down to a narrow GameConfig, so a new
// field is dropped unless it is explicitly mapped — which is exactly how the
// Games list would silently show every game as live.

describe('GET /api/status carries build status', () => {
  const adminEnv = (games: unknown[]) => {
    vi.stubGlobal('fetch', registryFetch(games));
    const { db } = makeDB([]);
    return {
      GITHUB_TOKEN: 'x',
      DB: db,
      AUTH: {
        fetch: async () =>
          new Response(JSON.stringify({ email: 'serge.the.dev@gmail.com' }), { status: 200 }),
      },
      ADMIN_EMAILS: 'serge.the.dev@gmail.com',
    } as unknown as Parameters<typeof worker.fetch>[1];
  };

  const getStatus = (env: any) =>
    worker.fetch(
      new Request('https://admin.freegamestore.online/api/status', {
        headers: { 'X-FGS-Token': 't' },
      }),
      env,
    );

  it('passes pending and failed through unchanged', async () => {
    const res = await getStatus(
      adminEnv([
        { id: 'a', name: 'A', status: 'pending' },
        { id: 'b', name: 'B', status: 'failed' },
      ]),
    );
    const games = (await res.json()) as Array<{ id: string; status: string }>;
    expect(games.find((g) => g.id === 'a')!.status).toBe('pending');
    expect(games.find((g) => g.id === 'b')!.status).toBe('failed');
  });

  it('reports a legacy entry with no status as live, not undefined', async () => {
    // The whole existing catalogue predates the field. Leaking `undefined` here
    // would make the console decide what a missing status means.
    const res = await getStatus(adminEnv([{ id: 'chess', name: 'Chess' }]));
    const games = (await res.json()) as Array<{ id: string; status: string }>;
    expect(games[0]!.status).toBe('live');
  });

  it('does not hide a game on an unrecognised status', async () => {
    const res = await getStatus(adminEnv([{ id: 'chess', name: 'Chess', status: 'wat' }]));
    const games = (await res.json()) as Array<{ id: string; status: string }>;
    expect(games[0]!.status).toBe('live');
  });
});

// GET /api/drift (#10 Part B) — the stale-deploy canary endpoint.

describe('GET /api/drift', () => {
  /** Registry read + the two per-game GitHub reads the canary makes. */
  function driftFetch(
    games: unknown[] | null,
    shas: Record<string, { head: string; success: string | null }>,
  ) {
    return async (input: unknown, init?: { headers?: Record<string, string> }) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/contents/registry.json') || url.includes('raw.githubusercontent')) {
        if (games === null) return new Response('upstream down', { status: 500 });
        const raw = (init?.headers?.Accept ?? '').includes('raw');
        return new Response(
          raw
            ? JSON.stringify({ games })
            : JSON.stringify({ content: btoa(JSON.stringify({ games })), sha: 's' }),
          { status: 200 },
        );
      }
      const m = /\/repos\/[^/]+\/([^/]+)\//.exec(url);
      const g = m ? shas[m[1]!] : undefined;
      if (g && url.includes('/git/ref/heads/main')) {
        return new Response(JSON.stringify({ object: { sha: g.head } }), { status: 200 });
      }
      if (g && url.includes('/actions/workflows/deploy.yml/runs')) {
        return new Response(
          JSON.stringify({ workflow_runs: g.success ? [{ head_sha: g.success }] : [] }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 200 });
    };
  }

  const adminEnv = () => {
    const { db } = makeDB([]);
    return {
      GITHUB_TOKEN: 'x',
      DB: db,
      AUTH: {
        fetch: async () =>
          new Response(JSON.stringify({ email: 'serge.the.dev@gmail.com' }), { status: 200 }),
      },
      ADMIN_EMAILS: 'serge.the.dev@gmail.com',
    } as unknown as Parameters<typeof worker.fetch>[1];
  };

  const get = (env: any, token = true) =>
    worker.fetch(
      new Request('https://admin.freegamestore.online/api/drift', {
        headers: token ? { 'X-FGS-Token': 't' } : {},
      }),
      env,
    );

  it('lists games whose HEAD is past their last successful build', async () => {
    vi.stubGlobal(
      'fetch',
      driftFetch([{ id: 'candy-shop' }, { id: 'chess' }], {
        'candy-shop': { head: 'aaaaaaa', success: 'bbbbbbb' },
        chess: { head: 'ccccccc', success: 'ccccccc' },
      }),
    );
    const res = await get(adminEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { drifted: { id: string }[]; checked: number };
    expect(body.drifted.map((d) => d.id)).toEqual(['candy-shop']);
    expect(body.checked).toBe(2);
  });

  it('503s rather than reporting a false all-clear when the registry read fails', async () => {
    // Zero games would otherwise mean zero drift — the same false-clear trap
    // reconcile guards against.
    vi.stubGlobal('fetch', driftFetch(null, {}));
    const res = await get(adminEnv());
    expect(res.status).toBe(503);
  });

  it('is admin-gated', async () => {
    vi.stubGlobal('fetch', driftFetch([{ id: 'chess' }], { chess: { head: 'a', success: 'a' } }));
    const env = {
      GITHUB_TOKEN: 'x',
      DB: makeDB([]).db,
      AUTH: {
        fetch: async () =>
          new Response(JSON.stringify({ email: 'nobody@example.com' }), { status: 200 }),
      },
      ADMIN_EMAILS: 'serge.the.dev@gmail.com',
    } as unknown as Parameters<typeof worker.fetch>[1];
    const res = await get(env);
    expect(res.status).not.toBe(200);
  });
});

// New admin routes from #14 Slice A/B.

describe('GET /api/ping', () => {
  const env = () =>
    ({
      DB: makeDB([]).db,
      AUTH: {
        fetch: async () =>
          new Response(JSON.stringify({ email: 'serge.the.dev@gmail.com' }), { status: 200 }),
      },
      ADMIN_EMAILS: 'serge.the.dev@gmail.com',
    }) as unknown as Parameters<typeof worker.fetch>[1];

  it('reports the worker identity to an admin', async () => {
    vi.stubGlobal('fetch', registryFetch([]));
    const res = await worker.fetch(
      new Request('https://admin.freegamestore.online/api/ping', {
        headers: { 'X-FGS-Token': 't' },
      }),
      env(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, worker: 'freegamestore-admin' });
  });

  it('is admin-gated — an unauthenticated probe must not confirm the worker', async () => {
    vi.stubGlobal('fetch', registryFetch([]));
    const anon = {
      DB: makeDB([]).db,
      AUTH: {
        fetch: async () =>
          new Response(JSON.stringify({ email: 'nobody@example.com' }), { status: 200 }),
      },
      ADMIN_EMAILS: 'serge.the.dev@gmail.com',
    } as unknown as Parameters<typeof worker.fetch>[1];
    const res = await worker.fetch(
      new Request('https://admin.freegamestore.online/api/ping', {
        headers: { 'X-FGS-Token': 't' },
      }),
      anon,
    );
    expect(res.status).not.toBe(200);
  });
});

describe('GET /api/status/deploys', () => {
  function fleetFetch(
    games: unknown[],
    runs: Record<string, { head: string; conclusion: string | null }>,
  ) {
    return async (input: unknown, init?: { headers?: Record<string, string> }) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/contents/registry.json') || url.includes('raw.githubusercontent')) {
        const raw = (init?.headers?.Accept ?? '').includes('raw');
        return new Response(
          raw
            ? JSON.stringify({ games })
            : JSON.stringify({ content: btoa(JSON.stringify({ games })), sha: 's' }),
          { status: 200 },
        );
      }
      const m = /\/repos\/[^/]+\/([^/]+)\//.exec(url);
      const g = m ? runs[m[1]!] : undefined;
      if (g && url.includes('/git/ref/heads/main')) {
        return new Response(JSON.stringify({ object: { sha: g.head } }), { status: 200 });
      }
      if (g && url.includes('/actions/workflows/deploy.yml/runs')) {
        return new Response(
          JSON.stringify({
            workflow_runs: g.conclusion
              ? [
                  {
                    status: 'completed',
                    conclusion: g.conclusion,
                    head_sha: g.conclusion === 'success' ? g.head : 'othersha',
                  },
                ]
              : [],
          }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 200 });
    };
  }

  const env = () =>
    ({
      GITHUB_TOKEN: 'x',
      DB: makeDB([]).db,
      AUTH: {
        fetch: async () =>
          new Response(JSON.stringify({ email: 'serge.the.dev@gmail.com' }), { status: 200 }),
      },
      ADMIN_EMAILS: 'serge.the.dev@gmail.com',
    }) as unknown as Parameters<typeof worker.fetch>[1];

  it('reports the last conclusion and the drift flag per game', async () => {
    vi.stubGlobal(
      'fetch',
      fleetFetch([{ id: 'green' }, { id: 'red' }], {
        green: { head: 'aaaaaaa', conclusion: 'success' },
        red: { head: 'bbbbbbb', conclusion: 'failure' },
      }),
    );
    const res = await worker.fetch(
      new Request('https://admin.freegamestore.online/api/status/deploys', {
        headers: { 'X-FGS-Token': 't' },
      }),
      env(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      games: { id: string; conclusion: string | null; drifted: boolean }[];
    };
    const green = body.games.find((g) => g.id === 'green')!;
    const red = body.games.find((g) => g.id === 'red')!;
    expect(green.conclusion).toBe('success');
    expect(green.drifted).toBe(false);
    // Its only run failed on a different sha, so main is past the last success.
    expect(red.conclusion).toBe('failure');
    expect(red.drifted).toBe(true);
  });
});

describe('GET /api/games/:id/detail', () => {
  function detailFetch(games: unknown[], opts: { headOk?: boolean } = {}) {
    return async (input: unknown, init?: { method?: string; headers?: Record<string, string> }) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/contents/registry.json') || url.includes('raw.githubusercontent')) {
        const raw = (init?.headers?.Accept ?? '').includes('raw');
        return new Response(
          raw
            ? JSON.stringify({ games })
            : JSON.stringify({ content: btoa(JSON.stringify({ games })), sha: 's' }),
          { status: 200 },
        );
      }
      if (url.includes('/actions/workflows/deploy.yml/runs')) {
        return new Response(
          JSON.stringify({
            workflow_runs: [
              {
                status: 'completed',
                conclusion: 'failure',
                head_sha: 'abcdef1234',
                updated_at: '2026-08-09T06:00:00Z',
                html_url: 'https://gh/run/1',
                head_commit: { message: 'break it\nbody' },
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (init?.method === 'HEAD') {
        return new Response(null, { status: opts.headOk === false ? 502 : 200 });
      }
      return new Response('{}', { status: 200 });
    };
  }

  const envWithRoute = (routeSlugs: string[]) =>
    ({
      GITHUB_TOKEN: 'x',
      DB: {
        prepare: () => ({
          bind: () => ({
            first: async () =>
              routeSlugs.length
                ? { slug: routeSlugs[0], r2_prefix: `games/${routeSlugs[0]}`, hosted_on: 'r2' }
                : null,
            run: async () => ({}),
            all: async () => ({ results: [] }),
          }),
        }),
      },
      AUTH: {
        fetch: async () =>
          new Response(JSON.stringify({ email: 'serge.the.dev@gmail.com' }), { status: 200 }),
      },
      ADMIN_EMAILS: 'serge.the.dev@gmail.com',
    }) as unknown as Parameters<typeof worker.fetch>[1];

  const get = (env: any, id = 'candy-shop') =>
    worker.fetch(
      new Request(`https://admin.freegamestore.online/api/games/${id}/detail`, {
        headers: { 'X-FGS-Token': 't' },
      }),
      env,
    );

  it('returns reachability, route, registry and recent runs in one payload', async () => {
    vi.stubGlobal(
      'fetch',
      detailFetch([
        { id: 'candy-shop', name: 'Candy Shop', status: 'pending', creatorGithub: 'alice' },
      ]),
    );
    const res = await get(envWithRoute(['candy-shop']));
    expect(res.status).toBe(200);
    const b = (await res.json()) as any;
    expect(b.listed).toBe(true);
    expect(b.status).toBe('pending');
    expect(b.route.configured).toBe(true);
    expect(b.http.status).toBe(200);
    expect(b.runs[0].conclusion).toBe('failure');
    expect(b.runs[0].sha).toBe('abcdef1');
    // Only the commit subject, never the whole body.
    expect(b.runs[0].message).toBe('break it');
  });

  it('reports an unlisted game with no route rather than 404ing', async () => {
    // A half-provisioned game is exactly what an operator opens this page to
    // investigate — refusing to render it would hide the problem.
    vi.stubGlobal('fetch', detailFetch([]));
    const res = await get(envWithRoute([]));
    expect(res.status).toBe(200);
    const b = (await res.json()) as any;
    expect(b.listed).toBe(false);
    expect(b.route.configured).toBe(false);
    expect(b.status).toBe('live'); // absent entry → readGameStatus default
  });

  it('survives an unreachable host instead of failing the page', async () => {
    vi.stubGlobal(
      'fetch',
      detailFetch([{ id: 'candy-shop', name: 'Candy Shop' }], { headOk: false }),
    );
    const b = (await (await get(envWithRoute(['candy-shop']))).json()) as any;
    expect(b.http.ok).toBe(false);
    expect(b.http.status).toBe(502);
  });

  it('is admin-gated', async () => {
    vi.stubGlobal('fetch', detailFetch([{ id: 'candy-shop' }]));
    const anon = {
      GITHUB_TOKEN: 'x',
      DB: makeDB([]).db,
      AUTH: {
        fetch: async () =>
          new Response(JSON.stringify({ email: 'nobody@example.com' }), { status: 200 }),
      },
      ADMIN_EMAILS: 'serge.the.dev@gmail.com',
    } as unknown as Parameters<typeof worker.fetch>[1];
    expect((await get(anon)).status).not.toBe(200);
  });
});

// The Grants page (#14 item 5) sends optional `expiresAt` and `note` on
// POST /api/comp. Those fields were ALREADY accepted by the agent and already
// present on CompGrant — the old form simply never sent them. This guards the
// admin→agent proxy hop they now depend on, which had no coverage at all.

describe('admin→agent grant proxy', () => {
  function agentStub() {
    const seen: {
      path: string;
      method: string;
      body: string | null;
      token: string | null;
      actor: string | null;
    }[] = [];
    const AGENT = {
      fetch: async (input: any, init?: any) => {
        seen.push({
          path: new URL(typeof input === 'string' ? input : input.url).pathname,
          method: init?.method ?? 'GET',
          body: init?.body ?? null,
          token: init?.headers?.['X-Internal-Token'] ?? null,
          actor: init?.headers?.['X-Admin-Actor'] ?? null,
        });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    };
    return { seen, AGENT };
  }

  const env = (AGENT: any, admin = true) =>
    ({
      DB: makeDB([]).db,
      AGENT,
      INTERNAL_TOKEN: 'secret',
      AUTH: {
        fetch: async () =>
          new Response(
            JSON.stringify({ email: admin ? 'serge.the.dev@gmail.com' : 'nobody@example.com' }),
            { status: 200 },
          ),
      },
      ADMIN_EMAILS: 'serge.the.dev@gmail.com',
    }) as unknown as Parameters<typeof worker.fetch>[1];

  it('forwards expiresAt and note verbatim to the agent', async () => {
    vi.stubGlobal('fetch', registryFetch([]));
    const { seen, AGENT } = agentStub();
    const res = await worker.fetch(
      new Request('https://admin.freegamestore.online/api/comp', {
        method: 'POST',
        headers: { 'X-FGS-Token': 't', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          login: 'alice',
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          expiresAt: '2026-12-31',
          note: 'beta tester',
        }),
      }),
      env(AGENT),
    );
    expect(res.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.path).toBe('/v1/admin/comp');
    const body = JSON.parse(seen[0]!.body!);
    expect(body.expiresAt).toBe('2026-12-31');
    expect(body.note).toBe('beta tester');
    // The agent trusts the internal token and records who acted.
    expect(seen[0]!.token).toBe('secret');
    expect(seen[0]!.actor).toBe('serge.the.dev@gmail.com');
  });

  it('routes a revoke through to the agent', async () => {
    vi.stubGlobal('fetch', registryFetch([]));
    const { seen, AGENT } = agentStub();
    await worker.fetch(
      new Request('https://admin.freegamestore.online/api/comp/github%3A1', {
        method: 'DELETE',
        headers: { 'X-FGS-Token': 't' },
      }),
      env(AGENT),
    );
    expect(seen[0]!.method).toBe('DELETE');
    expect(seen[0]!.path).toContain('/v1/admin/comp');
  });

  it('refuses a non-admin without ever reaching the agent', async () => {
    vi.stubGlobal('fetch', registryFetch([]));
    const { seen, AGENT } = agentStub();
    const res = await worker.fetch(
      new Request('https://admin.freegamestore.online/api/comp', {
        method: 'POST',
        headers: { 'X-FGS-Token': 't', 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: 'alice', provider: 'anthropic', model: 'm' }),
      }),
      env(AGENT, false),
    );
    expect(res.status).toBe(401);
    expect(seen).toHaveLength(0);
  });
});

// #25: the sessions proxy must forward ?cursor=&limit=. Its mapping was the one
// entry in the chain that omitted `+ url.search`, so pagination params never
// reached the agent no matter what the SPA sent.

describe('sessions proxy forwards pagination params', () => {
  function agentStub() {
    const seen: string[] = [];
    const AGENT = {
      fetch: async (input: any) => {
        const u = new URL(typeof input === 'string' ? input : input.url);
        seen.push(u.pathname + u.search);
        return new Response(JSON.stringify({ sessions: [], next_cursor: null, total: 0 }), {
          status: 200,
        });
      },
    };
    return { seen, AGENT };
  }

  const env = (AGENT: any) =>
    ({
      DB: makeDB([]).db,
      AGENT,
      INTERNAL_TOKEN: 'secret',
      AUTH: {
        fetch: async () =>
          new Response(JSON.stringify({ email: 'serge.the.dev@gmail.com' }), { status: 200 }),
      },
      ADMIN_EMAILS: 'serge.the.dev@gmail.com',
    }) as unknown as Parameters<typeof worker.fetch>[1];

  it('passes cursor and limit through to the agent', async () => {
    vi.stubGlobal('fetch', registryFetch([]));
    const { seen, AGENT } = agentStub();
    const res = await worker.fetch(
      new Request('https://admin.freegamestore.online/api/sessions?cursor=40&limit=20', {
        headers: { 'X-FGS-Token': 't' },
      }),
      env(AGENT),
    );
    expect(res.status).toBe(200);
    expect(seen[0]).toBe('/v1/admin/sessions?cursor=40&limit=20');
  });

  it('still works with no params (first page)', async () => {
    vi.stubGlobal('fetch', registryFetch([]));
    const { seen, AGENT } = agentStub();
    await worker.fetch(
      new Request('https://admin.freegamestore.online/api/sessions', {
        headers: { 'X-FGS-Token': 't' },
      }),
      env(AGENT),
    );
    expect(seen[0]).toBe('/v1/admin/sessions');
  });
});

// POST /api/games/:id/heal-route (#23, re-scoped). FGS has no per-game DNS to
// fix — the host serves a wildcard route — so the only thing that can go missing
// is the D1 routes row, which reconcile heals hourly. This is the manual path.

describe('POST /api/games/:id/heal-route', () => {
  const envWith = (games: unknown[] | null, admin = true) => {
    vi.stubGlobal('fetch', registryFetch(games));
    const { calls, db } = makeDB([]);
    return {
      calls,
      env: {
        GITHUB_TOKEN: 'x',
        DB: db,
        AUTH: {
          fetch: async () =>
            new Response(
              JSON.stringify({ email: admin ? 'serge.the.dev@gmail.com' : 'nobody@example.com' }),
              { status: 200 },
            ),
        },
        ADMIN_EMAILS: 'serge.the.dev@gmail.com',
      } as unknown as Parameters<typeof worker.fetch>[1],
    };
  };

  const heal = (env: any, id = 'chess') =>
    worker.fetch(
      new Request(`https://admin.freegamestore.online/api/games/${id}/heal-route`, {
        method: 'POST',
        headers: { 'X-FGS-Token': 't' },
      }),
      env,
    );

  it('re-inserts the route for a listed game', async () => {
    const { calls, env } = envWith([{ id: 'chess' }]);
    const res = await heal(env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; step: { status: string } };
    expect(body.ok).toBe(true);
    const inserts = calls.filter((c) => /INSERT INTO routes/i.test(c.sql));
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.binds[0]).toBe('chess');
  });

  it('refuses a game that is not in the registry, without writing a route', async () => {
    // Writing a route for an unlisted id recreates exactly the orphan-route
    // drift reconcile deletes on its next pass — churn dressed up as a fix.
    const { calls, env } = envWith([{ id: 'chess' }]);
    const res = await heal(env, 'ghost');
    expect(res.status).toBe(400);
    expect(calls.filter((c) => /INSERT INTO routes/i.test(c.sql))).toHaveLength(0);
  });

  it('503s rather than healing blind when the registry read fails', async () => {
    const { calls, env } = envWith(null);
    const res = await heal(env);
    expect(res.status).toBe(503);
    expect(calls.filter((c) => /INSERT INTO routes/i.test(c.sql))).toHaveLength(0);
  });

  it('is admin-gated — a non-admin cannot write a hosting route', async () => {
    const { calls, env } = envWith([{ id: 'chess' }], false);
    const res = await heal(env);
    expect(res.status).not.toBe(200);
    expect(calls.filter((c) => /INSERT INTO routes/i.test(c.sql))).toHaveLength(0);
  });
});

// CI test report (#24) and per-game traffic (#23 item 6). Both are INERT until
// their Cloudflare resources exist, so the 503 path is the primary behaviour
// today and is tested first — it is the correct state, not a failure.

function kvStub(initial: string | null = null) {
  const store = new Map<string, string>();
  if (initial !== null) store.set('latest-test-report', initial);
  return {
    store,
    CI_KV: {
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, v: string) => {
        store.set(k, v);
      },
    },
  };
}

const adminAuth = () => ({
  fetch: async () =>
    new Response(JSON.stringify({ email: 'serge.the.dev@gmail.com' }), { status: 200 }),
});

describe('CI test report endpoints (#24)', () => {
  const baseEnv = (extra: Record<string, unknown>) =>
    ({
      DB: makeDB([]).db,
      AUTH: adminAuth(),
      ADMIN_EMAILS: 'serge.the.dev@gmail.com',
      ...extra,
    }) as unknown as Parameters<typeof worker.fetch>[1];

  const getReport = (env: any) =>
    worker.fetch(
      new Request('https://admin.freegamestore.online/api/ci/test-report', {
        headers: { 'X-FGS-Token': 't' },
      }),
      env,
    );

  const putReport = (env: any, body: string, token?: string) =>
    worker.fetch(
      new Request('https://admin.freegamestore.online/api/ci/test-report', {
        method: 'PUT',
        headers: token ? { 'X-CI-Token': token } : {},
        body,
      }),
      env,
    );

  it('GET 503s while the KV namespace is not bound', async () => {
    vi.stubGlobal('fetch', registryFetch([]));
    const res = await getReport(baseEnv({}));
    expect(res.status).toBe(503);
    expect((await res.json()) as any).toEqual({ error: 'CI_KV not bound' });
  });

  it('PUT 503s while the KV namespace is not bound', async () => {
    vi.stubGlobal('fetch', registryFetch([]));
    const res = await putReport(baseEnv({ CI_TOKEN: 'ci' }), '<html></html>', 'ci');
    expect(res.status).toBe(503);
  });

  it('GET serves the stored report as HTML', async () => {
    vi.stubGlobal('fetch', registryFetch([]));
    const { CI_KV } = kvStub('<html><body>pass</body></html>');
    const res = await getReport(baseEnv({ CI_KV }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    expect(await res.text()).toContain('pass');
  });

  it('GET 404s when KV is bound but empty', async () => {
    vi.stubGlobal('fetch', registryFetch([]));
    const { CI_KV } = kvStub(null);
    expect((await getReport(baseEnv({ CI_KV }))).status).toBe(404);
  });

  it('GET is admin-gated', async () => {
    vi.stubGlobal('fetch', registryFetch([]));
    const { CI_KV } = kvStub('<html>x</html>');
    const env = baseEnv({
      CI_KV,
      AUTH: {
        fetch: async () =>
          new Response(JSON.stringify({ email: 'nobody@example.com' }), { status: 200 }),
      },
    });
    expect((await getReport(env)).status).not.toBe(200);
  });

  it('PUT stores the report with a valid CI token', async () => {
    vi.stubGlobal('fetch', registryFetch([]));
    const { CI_KV, store } = kvStub();
    const res = await putReport(baseEnv({ CI_KV, CI_TOKEN: 'ci' }), '<html>ok</html>', 'ci');
    expect(res.status).toBe(200);
    expect(store.get('latest-test-report')).toBe('<html>ok</html>');
  });

  it('PUT rejects a missing or wrong CI token without writing', async () => {
    vi.stubGlobal('fetch', registryFetch([]));
    const { CI_KV, store } = kvStub();
    const env = baseEnv({ CI_KV, CI_TOKEN: 'ci' });
    expect((await putReport(env, '<html>x</html>')).status).toBe(401);
    expect((await putReport(env, '<html>x</html>', 'wrong')).status).toBe(401);
    expect(store.size).toBe(0);
  });

  it('PUT rejects a body over the 512 KB cap, measured in bytes', async () => {
    vi.stubGlobal('fetch', registryFetch([]));
    const { CI_KV, store } = kvStub();
    // Multi-byte characters: this is well under 512K CHARACTERS but over the
    // byte cap, which is the case a naive length check would let through.
    const oversized = 'é'.repeat(300 * 1024);
    const res = await putReport(baseEnv({ CI_KV, CI_TOKEN: 'ci' }), oversized, 'ci');
    expect(res.status).toBe(413);
    expect(store.size).toBe(0);
  });
});

describe('GET /api/games/:id/traffic (#23 item 6)', () => {
  const env = (extra: Record<string, unknown> = {}) =>
    ({
      DB: makeDB([]).db,
      AUTH: adminAuth(),
      ADMIN_EMAILS: 'serge.the.dev@gmail.com',
      ...extra,
    }) as unknown as Parameters<typeof worker.fetch>[1];

  const get = (e: any, id = 'chess') =>
    worker.fetch(
      new Request(`https://admin.freegamestore.online/api/games/${id}/traffic`, {
        headers: { 'X-FGS-Token': 't' },
      }),
      e,
    );

  /** Registry reads plus the Cloudflare GraphQL POST. */
  function cfStub(payload: unknown, status = 200) {
    const seen: { url: string; body: any }[] = [];
    return {
      seen,
      fetchFn: async (
        input: unknown,
        init?: { method?: string; body?: string; headers?: Record<string, string> },
      ) => {
        const url = typeof input === 'string' ? input : (input as Request).url;
        if (url.includes('/client/v4/graphql')) {
          seen.push({ url, body: JSON.parse(init!.body!) });
          return new Response(JSON.stringify(payload), { status });
        }
        return registryFetch([])(input as any);
      },
    };
  }

  it('503s when the token or zone id is missing — the state today', async () => {
    vi.stubGlobal('fetch', registryFetch([]));
    expect((await get(env())).status).toBe(503);
    expect((await get(env({ CF_API_TOKEN: 't' }))).status).toBe(503);
    expect((await get(env({ CF_ZONE_ID: 'z' }))).status).toBe(503);
    const res = await get(env());
    expect((await res.json()) as any).toEqual({
      error: 'CF_API_TOKEN or CF_ZONE_ID not configured',
    });
  });

  it("queries the zone filtered to the game's hostname and totals the days", async () => {
    const { seen, fetchFn } = cfStub({
      data: {
        viewer: {
          zones: [
            {
              httpRequests1dGroups: [
                {
                  dimensions: { date: '2026-08-01' },
                  sum: { requests: 100, pageViews: 40 },
                  uniq: { uniques: 10 },
                },
                {
                  dimensions: { date: '2026-08-02' },
                  sum: { requests: 50, pageViews: 20 },
                  uniq: { uniques: 5 },
                },
              ],
            },
          ],
        },
      },
    });
    vi.stubGlobal('fetch', fetchFn);
    const res = await get(env({ CF_API_TOKEN: 't', CF_ZONE_ID: 'zone123' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.host).toBe('chess.freegamestore.online');
    expect(body.totals).toEqual({ requests: 150, pageViews: 60, visitors: 15 });
    expect(seen[0]!.body.variables.zone).toBe('zone123');
    expect(seen[0]!.body.variables.host).toBe('chess.freegamestore.online');
  });

  it('surfaces a GraphQL error instead of rendering it as zero traffic', async () => {
    // Cloudflare returns errors with HTTP 200; treating that as an empty result
    // would show a healthy-looking zero instead of a broken query.
    const { fetchFn } = cfStub({ errors: [{ message: 'zone not found' }] });
    vi.stubGlobal('fetch', fetchFn);
    const res = await get(env({ CF_API_TOKEN: 't', CF_ZONE_ID: 'bad' }));
    expect(res.status).toBe(502);
    expect(((await res.json()) as any).error).toContain('zone not found');
  });

  it('is admin-gated', async () => {
    const { fetchFn } = cfStub({ data: { viewer: { zones: [] } } });
    vi.stubGlobal('fetch', fetchFn);
    const e = env({
      CF_API_TOKEN: 't',
      CF_ZONE_ID: 'z',
      AUTH: {
        fetch: async () =>
          new Response(JSON.stringify({ email: 'nobody@example.com' }), { status: 200 }),
      },
    });
    expect((await get(e)).status).not.toBe(200);
  });
});

// #67: provisioning's own commits (template generate, naming) trigger deploy.yml
// too. The backstop took the newest completed run of ANY commit, so a game whose
// creator code was never pushed went `live` showing the blank template.
describe('reconcile backstop ignores the template scaffold build (#67)', () => {
  const P = 'p'.repeat(40); // provisionedSha: HEAD when provisioning finished
  const C = 'c'.repeat(40); // a later (creator) commit

  type Run = { head_sha: string; conclusion: string; message?: string };

  /** Fake GitHub: registry + deploy.yml runs (newest first) + compare API. */
  function fakeGitHub(
    game: Record<string, unknown>,
    runs: Run[],
    compare: Record<string, number | string> = {},
  ) {
    const puts: Array<any[]> = [];
    vi.stubGlobal(
      'fetch',
      async (
        input: unknown,
        init?: { method?: string; body?: string; headers?: Record<string, string> },
      ) => {
        const url = typeof input === 'string' ? input : (input as Request).url;
        const method = init?.method ?? 'GET';
        if (url.includes('/actions/workflows/deploy.yml/runs')) {
          return new Response(
            JSON.stringify({
              workflow_runs: runs.map((r) => ({
                status: 'completed',
                conclusion: r.conclusion,
                head_sha: r.head_sha,
                head_commit: { message: r.message ?? 'x' },
              })),
            }),
            { status: 200 },
          );
        }
        const cmp = /\/compare\/([^./]+)\.\.\.([^./]+)$/.exec(url);
        if (cmp) {
          const answer = compare[cmp[2]!] ?? 'ahead';
          return typeof answer === 'number'
            ? new Response('{}', { status: answer })
            : new Response(JSON.stringify({ status: answer }), { status: 200 });
        }
        if (url.includes('/contents/registry.json')) {
          if (method === 'GET') {
            const raw = (init?.headers?.Accept ?? '').includes('raw');
            return new Response(
              raw
                ? JSON.stringify({ games: [game] })
                : JSON.stringify({ content: btoa(JSON.stringify({ games: [game] })), sha: 'sha1' }),
              { status: 200 },
            );
          }
          puts.push(JSON.parse(atob(JSON.parse(init!.body!).content)).games);
          return new Response(JSON.stringify({ content: { sha: 'sha2' } }), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      },
    );
    return puts;
  }

  const statusAfter = async (puts: Array<any[]>) => {
    const { db } = makeDB(['space-rescue']);
    await runScheduled({ GITHUB_TOKEN: 'x', DB: db });
    return puts.length ? puts[0]!.find((g: any) => g.id === 'space-rescue').status : 'pending';
  };
  const pending = { id: 'space-rescue', status: 'pending', provisionedSha: P };

  it('keeps a game pending when the only successful build is the scaffold', async () => {
    const puts = fakeGitHub(pending, [{ head_sha: P, conclusion: 'success' }]);
    expect(await statusAfter(puts)).toBe('pending');
  });

  it('keeps a game pending for a scaffold commit before the provisioned HEAD', async () => {
    const early = 'e'.repeat(40);
    const puts = fakeGitHub(pending, [{ head_sha: early, conclusion: 'success' }], {
      [early]: 'behind',
    });
    expect(await statusAfter(puts)).toBe('pending');
  });

  it('goes live once a build on a later (creator) commit succeeds', async () => {
    const puts = fakeGitHub(pending, [
      { head_sha: C, conclusion: 'success' },
      { head_sha: P, conclusion: 'success' },
    ]);
    expect(await statusAfter(puts)).toBe('live');
  });

  it('fails when the creator build fails even though the scaffold built', async () => {
    const puts = fakeGitHub(pending, [
      { head_sha: C, conclusion: 'failure' },
      { head_sha: P, conclusion: 'success' },
    ]);
    expect(await statusAfter(puts)).toBe('failed');
  });

  it('counts a force-pushed project (no common history) as creator code', async () => {
    const puts = fakeGitHub(pending, [{ head_sha: C, conclusion: 'success' }], { [C]: 404 });
    expect(await statusAfter(puts)).toBe('live');
  });

  it('stays pending when GitHub cannot say whether a run is past the scaffold', async () => {
    const puts = fakeGitHub(pending, [{ head_sha: C, conclusion: 'success' }], { [C]: 500 });
    expect(await statusAfter(puts)).toBe('pending');
  });

  it('legacy entries without provisionedSha skip runs of provisioning commits', async () => {
    const legacy = { id: 'space-rescue', status: 'pending' };
    for (const message of ['Initial commit', 'Set game name to "Space Rescue"']) {
      const puts = fakeGitHub(legacy, [{ head_sha: P, conclusion: 'success', message }]);
      expect(await statusAfter(puts)).toBe('pending');
    }
    const puts = fakeGitHub(legacy, [
      { head_sha: C, conclusion: 'success', message: 'Add a boss level' },
    ]);
    expect(await statusAfter(puts)).toBe('live');
  });
});
