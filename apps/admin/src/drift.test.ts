import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkGameDrift, findDrift } from './drift';

// Stale-deploy canary (#10 Part B). The failure it exists to catch: the host
// keeps serving the last good R2 artifact while the repo has moved on, so the
// game looks published but users never received the newer commits.

const ORG = 'freegamestore-online';
const env = { GITHUB_TOKEN: 't' };

const urlOf = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
};

/** Route the two GitHub reads per game. `head` is main's SHA; `success` is the
 *  head_sha of the last successful deploy.yml run (null → no successful run). */
function stubGh(
  games: Record<
    string,
    { head?: string | null; success?: string | null; refFails?: boolean; runsFail?: boolean }
  >,
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input);
      const m = /\/repos\/[^/]+\/([^/]+)\//.exec(url);
      const g = m ? games[m[1]!] : undefined;
      if (!g) return new Response('nope', { status: 404 });
      if (url.includes('/git/ref/heads/main')) {
        if (g.refFails) return new Response('boom', { status: 500 });
        return new Response(JSON.stringify({ object: { sha: g.head ?? null } }), { status: 200 });
      }
      if (url.includes('/actions/workflows/deploy.yml/runs')) {
        if (g.runsFail) return new Response('boom', { status: 500 });
        return new Response(
          JSON.stringify({ workflow_runs: g.success ? [{ head_sha: g.success }] : [] }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 200 });
    }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('checkGameDrift', () => {
  it('flags a game whose HEAD is past its last successful build', async () => {
    stubGh({ 'candy-shop': { head: 'aaaaaaa1111', success: 'bbbbbbb2222' } });
    const r = await checkGameDrift(env, ORG, 'candy-shop');
    expect(r.state).toBe('drifted');
    expect(r.headSha).toBe('aaaaaaa');
    expect(r.lastSuccessSha).toBe('bbbbbbb');
  });

  it('reports current when the last successful build IS the HEAD', async () => {
    stubGh({ chess: { head: 'ccccccc3333', success: 'ccccccc3333' } });
    expect((await checkGameDrift(env, ORG, 'chess')).state).toBe('current');
  });

  it('separates never-built from drifted', async () => {
    // No successful run at all is #22's `pending` territory, not stale serving —
    // conflating them would report a brand-new game as though it had regressed.
    stubGh({ fresh: { head: 'ddddddd4444', success: null } });
    expect((await checkGameDrift(env, ORG, 'fresh')).state).toBe('neverBuilt');
  });

  it('reports unknown rather than inferring drift when HEAD is unreadable', async () => {
    // A false all-clear is bad; a false ALARM that sends an operator chasing a
    // healthy game is also bad. An API failure is neither — say unknown.
    stubGh({ gone: { refFails: true, success: 'eeeeeee5555' } });
    expect((await checkGameDrift(env, ORG, 'gone')).state).toBe('unknown');
  });

  it('reports unknown when the runs query fails, even with a readable HEAD', async () => {
    stubGh({ flaky: { head: 'fffffff6666', runsFail: true } });
    expect((await checkGameDrift(env, ORG, 'flaky')).state).toBe('unknown');
  });
});

describe('findDrift', () => {
  it('buckets a mixed fleet and sorts each bucket', async () => {
    stubGh({
      zeta: { head: '1111111', success: '2222222' }, // drifted
      alpha: { head: '3333333', success: '4444444' }, // drifted
      chess: { head: '5555555', success: '5555555' }, // current
      fresh: { head: '6666666', success: null }, // never built
      gone: { refFails: true }, // unknown
    });
    const report = await findDrift(env, ORG, ['zeta', 'alpha', 'chess', 'fresh', 'gone']);

    expect(report.drifted.map((d) => d.id)).toEqual(['alpha', 'zeta']);
    expect(report.neverBuilt).toEqual(['fresh']);
    expect(report.unknown).toEqual(['gone']);
    // `checked` counts only games that were genuinely comparable.
    expect(report.checked).toBe(3);
    expect(report.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('reports no drift for a wholly healthy fleet', async () => {
    stubGh({
      a: { head: '1111111', success: '1111111' },
      b: { head: '2222222', success: '2222222' },
    });
    const report = await findDrift(env, ORG, ['a', 'b']);
    expect(report.drifted).toEqual([]);
    expect(report.checked).toBe(2);
  });

  it('handles an empty fleet without hanging', async () => {
    stubGh({});
    const report = await findDrift(env, ORG, []);
    expect(report.checked).toBe(0);
    expect(report.drifted).toEqual([]);
  });

  it('caps concurrent GitHub calls while still covering every game', async () => {
    // ~127 games × 2 calls would otherwise open 254 sockets at once.
    let inFlight = 0;
    let peak = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = urlOf(input);
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
        if (url.includes('/git/ref/heads/main')) {
          return new Response(JSON.stringify({ object: { sha: '1111111' } }), { status: 200 });
        }
        return new Response(JSON.stringify({ workflow_runs: [{ head_sha: '1111111' }] }), {
          status: 200,
        });
      }),
    );

    const ids = Array.from({ length: 40 }, (_, i) => `game-${i}`);
    const report = await findDrift(env, ORG, ids);
    expect(report.checked).toBe(40);
    // 8 workers, each issuing 2 calls in parallel for its game → at most 16.
    expect(peak).toBeLessThanOrEqual(16);
  });
});
