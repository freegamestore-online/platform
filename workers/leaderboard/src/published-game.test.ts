import { beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { __clearPublishedGameCache, isPublishedGame } from './index';

// #73: the leaderboard only accepted a hardcoded list of 29 legacy game ids, so
// every game created since (console, MCP, agent) got 400 "Invalid game" for
// both score submission and board reads. A game is now valid when it is
// published, i.e. has a host route in the shared freegamestore D1.

const SECRET = 'test-secret';
const LB = 'https://leaderboard.freegamestore.online';

/** Shared freegamestore D1 stub: answers the routes lookup. */
function routesDb(published: string[], opts: { throws?: boolean } = {}) {
  const queries: unknown[][] = [];
  const db = {
    prepare: (_sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => {
          queries.push(args);
          if (opts.throws) throw new Error('D1_ERROR: simulated outage');
          return published.includes(args[0] as string) ? { ok: 1 } : null;
        },
      }),
    }),
  } as unknown as D1Database;
  return { db, queries };
}

/** Leaderboard D1 stub: empty boards; inserts succeed. */
function scoresDb() {
  const runs: unknown[][] = [];
  const db = {
    prepare: () => ({
      bind: (...args: unknown[]) => ({
        all: async () => ({ results: [] }),
        first: async () => ({ rank: 0, best: null }),
        run: async () => {
          runs.push(args);
          return { meta: { changes: 1 } };
        },
      }),
    }),
  } as unknown as D1Database;
  return { db, runs };
}

const b64url = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/** A real auth-style leaderboard handoff for `game`. */
async function handoff(game: string): Promise<string> {
  const enc = new TextEncoder();
  const h = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const p = b64url(
    enc.encode(
      JSON.stringify({
        typ: 'fgs_handoff',
        aud: LB,
        game,
        sub: 'github:1',
        name: 'Grace',
        exp: Math.floor(Date.now() / 1000) + 300,
      }),
    ),
  );
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${h}.${p}`)));
  return `${h}.${p}.${b64url(sig)}`;
}

function env(published: string[], opts: { throws?: boolean } = {}) {
  const routes = routesDb(published, opts);
  const scores = scoresDb();
  return {
    env: { DB: scores.db, ROUTES_DB: routes.db, JWT_SECRET: SECRET } as never,
    routes,
    scores,
  };
}

const board = (game: string, e: never) =>
  worker.fetch(new Request(`${LB}/api/leaderboard/${game}`), e);

async function submit(game: string, e: never) {
  return worker.fetch(
    new Request(`${LB}/api/scores`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: `https://${game}.freegamestore.online`,
        Authorization: `Bearer ${await handoff(game)}`,
      },
      body: JSON.stringify({ game, score: 120 }),
    }),
    e,
  );
}

beforeEach(() => __clearPublishedGameCache());

describe('published games can use the leaderboard (#73)', () => {
  it('reads the board of a newly published game', async () => {
    const { env: e } = env(['space-rescue']);
    expect((await board('space-rescue', e)).status).toBe(200);
  });

  it('accepts a score for a newly published game', async () => {
    const { env: e, scores } = env(['space-rescue']);
    const res = await submit('space-rescue', e);
    expect(res.status).toBe(201);
    expect(scores.runs).toHaveLength(1);
  });

  it('still serves a legacy game that has a route', async () => {
    const { env: e } = env(['chess']);
    expect((await board('chess', e)).status).toBe(200);
  });

  it('rejects a game that is not published, without writing a score', async () => {
    const { env: e, scores } = env(['space-rescue']);
    expect((await board('not-a-game', e)).status).toBe(400);
    const res = await submit('not-a-game', e);
    expect(res.status).toBe(400);
    expect(scores.runs).toHaveLength(0);
  });

  it('answers 503, not "invalid game", when the routes database is unavailable', async () => {
    const { env: e } = env(['space-rescue'], { throws: true });
    expect((await board('space-rescue', e)).status).toBe(503);
  });
});

describe('isPublishedGame', () => {
  it('rejects malformed ids without querying', async () => {
    const { db, queries } = routesDb(['space-rescue']);
    for (const bad of ['Space', '-x', 'a/b', '', 'x'.repeat(59)]) {
      expect(await isPublishedGame(db, bad)).toBe(false);
    }
    expect(queries).toHaveLength(0);
  });

  it('caches lookups so a busy board does not hit D1 per request', async () => {
    const { db, queries } = routesDb(['space-rescue']);
    expect(await isPublishedGame(db, 'space-rescue')).toBe(true);
    expect(await isPublishedGame(db, 'space-rescue')).toBe(true);
    expect(queries).toHaveLength(1);
    expect(queries[0]).toEqual(['space-rescue', 'freegamestore.online']);
  });

  it('re-checks an unpublished id after a short TTL so a new game works quickly', async () => {
    vi.useFakeTimers();
    try {
      const published: string[] = [];
      const { db } = routesDb(published);
      expect(await isPublishedGame(db, 'brand-new')).toBe(false);
      published.push('brand-new'); // provisioned
      vi.advanceTimersByTime(31_000);
      expect(await isPublishedGame(db, 'brand-new')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
