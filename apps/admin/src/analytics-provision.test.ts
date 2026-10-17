import { afterEach, describe, expect, it, vi } from 'vitest';
import { type AnalyticsProvisionEnv, provisionGameAnalytics } from './analytics-provision';

// #353: publish provisions a CF Web Analytics beacon token per game. These cover
// the create, reuse and stored-token paths, and every failure mode, which must
// come back as a non-fatal `skip` and never throw.

const HOST = 'chess.freegamestore.online';
const TAG = 'a'.repeat(32);
const OTHER_TAG = 'b'.repeat(32);

afterEach(() => {
  vi.unstubAllGlobals();
});

function fakeDb(opts: { row?: { cf_beacon_token: string | null } | null; failWrite?: boolean } = {}) {
  const writes: unknown[][] = [];
  const db = {
    prepare: () => ({
      bind: (...args: unknown[]) => ({
        first: async () => opts.row ?? null,
        run: async () => {
          if (opts.failWrite) throw new Error('D1 unavailable');
          writes.push(args);
          return {};
        },
      }),
    }),
  };
  return { db: db as unknown as D1Database, writes };
}

function env(db: D1Database | undefined): AnalyticsProvisionEnv {
  return { CF_ACCOUNT_ID: 'acct', CF_API_TOKEN: 'tok', DB: db as D1Database };
}

function cfOk(result: unknown) {
  return new Response(JSON.stringify({ success: true, result }), { status: 200 });
}

function cfErr(message: string, status = 403) {
  return new Response(JSON.stringify({ success: false, errors: [{ message }] }), { status });
}

/** Routes CF calls: `list` answers the rum/site_info/list pages, `create` the POST. */
function stubCf(handlers: { list?: (page: number) => Response; create?: () => Response }) {
  const fetchMock = vi.fn(async (input: string, init?: { method?: string }) => {
    const url = String(input);
    if (url.includes('/rum/site_info/list')) {
      const page = Number(new URL(url).searchParams.get('page'));
      return handlers.list ? handlers.list(page) : cfOk([]);
    }
    if (url.endsWith('/rum/site_info') && init?.method === 'POST') {
      return handlers.create ? handlers.create() : cfOk({ site_tag: TAG });
    }
    throw new Error(`unexpected CF call ${init?.method ?? 'GET'} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('provisionGameAnalytics (#353)', () => {
  it('creates a RUM site for a new game and stores its beacon token', async () => {
    const { db, writes } = fakeDb({ row: null });
    const fetchMock = stubCf({});

    const step = await provisionGameAnalytics(env(db), 'chess', HOST);

    expect(step).toMatchObject({ name: 'CF Web Analytics', status: 'ok' });
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse((post![1] as { body: string }).body)).toEqual({ host: HOST, auto_install: false });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual(['chess', TAG, expect.any(Number)]);
  });

  it('reuses a RUM site that already exists for the host instead of creating one', async () => {
    const { db, writes } = fakeDb({ row: null });
    const fetchMock = stubCf({
      list: () => cfOk([{ host: 'other.freegamestore.online', site_tag: OTHER_TAG }, { host: HOST, site_tag: TAG }]),
    });

    const step = await provisionGameAnalytics(env(db), 'chess', HOST);

    expect(step.status).toBe('skip');
    expect(step.detail).toMatch(/already exists/);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    expect(writes[0]).toEqual(['chess', TAG, expect.any(Number)]);
  });

  it('finds the host on a later page of the RUM site list', async () => {
    const { db, writes } = fakeDb({ row: null });
    const fullPage = Array.from({ length: 100 }, (_, i) => ({ host: `g${i}.freegamestore.online`, site_tag: OTHER_TAG }));
    stubCf({
      list: (page) => (page === 1 ? cfOk(fullPage) : cfOk([{ host: HOST, site_tag: TAG }])),
    });

    const step = await provisionGameAnalytics(env(db), 'chess', HOST);

    expect(step.status).toBe('skip');
    expect(writes[0]).toEqual(['chess', TAG, expect.any(Number)]);
  });

  it('makes no CF calls when the game already has a valid beacon token', async () => {
    const { db, writes } = fakeDb({ row: { cf_beacon_token: TAG } });
    const fetchMock = stubCf({});

    const step = await provisionGameAnalytics(env(db), 'chess', HOST);

    expect(step.status).toBe('skip');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it('re-provisions when the stored token is malformed', async () => {
    const { db, writes } = fakeDb({ row: { cf_beacon_token: 'not-a-token' } });
    stubCf({});

    const step = await provisionGameAnalytics(env(db), 'chess', HOST);

    expect(step.status).toBe('ok');
    expect(writes[0]).toEqual(['chess', TAG, expect.any(Number)]);
  });

  it('is non-fatal when CF rejects the create: skip with CF\'s message, nothing stored', async () => {
    const { db, writes } = fakeDb({ row: null });
    stubCf({ create: () => cfErr('Authentication error') });

    const step = await provisionGameAnalytics(env(db), 'chess', HOST);

    expect(step).toEqual({
      name: 'CF Web Analytics',
      status: 'skip',
      detail: '(non-fatal) Authentication error',
    });
    expect(writes).toHaveLength(0);
  });

  it('is non-fatal when the CF API is unreachable (fetch throws)', async () => {
    const { db, writes } = fakeDb({ row: null });
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down');
    }));

    const step = await provisionGameAnalytics(env(db), 'chess', HOST);

    expect(step.status).toBe('skip');
    expect(step.detail).toContain('network down');
    expect(writes).toHaveLength(0);
  });

  it('is non-fatal when CF returns no usable site tag', async () => {
    const { db, writes } = fakeDb({ row: null });
    stubCf({ create: () => cfOk({ site_tag: 'tag-123' }) });

    const step = await provisionGameAnalytics(env(db), 'chess', HOST);

    expect(step.status).toBe('skip');
    expect(step.detail).toMatch(/no usable site tag/);
    expect(writes).toHaveLength(0);
  });

  it('tells the operator the token was minted when the D1 write fails', async () => {
    const { db } = fakeDb({ row: null, failWrite: true });
    stubCf({});

    const step = await provisionGameAnalytics(env(db), 'chess', HOST);

    expect(step.status).toBe('skip');
    expect(step.detail).toMatch(/storing it failed: D1 unavailable/);
  });

  it('is non-fatal when the D1 binding is missing entirely', async () => {
    stubCf({});

    const step = await provisionGameAnalytics(env(undefined), 'chess', HOST);

    expect(step.status).toBe('skip');
    expect(step.detail).toMatch(/^\(non-fatal\)/);
  });

  it('never reports fail, so it cannot flip a publish to unsuccessful', async () => {
    const { db } = fakeDb({ row: null });
    stubCf({ create: () => cfErr('boom', 500) });

    const step = await provisionGameAnalytics(env(db), 'chess', HOST);

    expect(step.status).not.toBe('fail');
  });
});
