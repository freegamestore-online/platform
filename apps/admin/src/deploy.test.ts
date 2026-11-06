import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { contentTypeFor, DEPLOY_AUDIENCE, GAME_ORG_ID, handleDeploy, pruneDeploys } from './deploy';
import type { Env } from './env';
import { _resetJwksCache } from './github-oidc';
import { insertHostRoute } from './publish';

// The same protocol and the same refusals as the FAS API's keyless deploy
// (freeappstore-online/platform packages/backend/src/routes/deploy.test.ts).

const registry = vi.hoisted(() => ({ games: [] as Array<{ id: string; repo?: string }> }));
vi.mock('./registryReader', () => ({
  readRegistry: async () => ({ status: 'available', games: registry.games, source: 'contents' }),
}));

const ISSUER = 'https://token.actions.githubusercontent.com';
const KID = 'deploy-test';

interface Stmt {
  all(...b: unknown[]): unknown[];
  get(...b: unknown[]): unknown;
  run(...b: unknown[]): { changes: number | bigint };
}
type Db = { exec(sql: string): void; prepare(sql: string): Stmt };
// vitest 2 cannot resolve node:sqlite through its module graph; require it.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => Db;
};
const migration = (name: string) =>
  readFileSync(
    new URL(`../../../workers/host/migrations/${name}`, import.meta.url).pathname,
    'utf8',
  );

/** The slice of D1 deploy.ts uses, over real SQLite (batch = one transaction). */
function d1(db: Db): D1Database {
  const prepare = (sql: string) => {
    let binds: unknown[] = [];
    const stmt = {
      sql,
      bind(...args: unknown[]) {
        binds = args;
        return stmt;
      },
      async first() {
        return db.prepare(sql).get(...binds) ?? null;
      },
      async all() {
        return { results: db.prepare(sql).all(...binds) };
      },
      async run() {
        return { meta: { changes: Number(db.prepare(sql).run(...binds).changes) } };
      },
    };
    return stmt;
  };
  return {
    prepare,
    async batch(stmts: Array<{ run(): Promise<unknown> }>) {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  } as unknown as D1Database;
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const b64json = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));

let priv: CryptoKey;
let jwk: JsonWebKey;
beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  priv = pair.privateKey;
  jwk = {
    ...((await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey),
    kid: KID,
  } as JsonWebKey;
});

let jtiSeq = 0;
/** A GitHub Actions token for `repo` (repository_id `repoId`) in freegamestore-online. */
async function oidc(repo: string, repoId: string, claims: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64json({ alg: 'RS256', typ: 'JWT', kid: KID });
  const p = b64json({
    iss: ISSUER,
    aud: DEPLOY_AUDIENCE,
    sub: `repo:freegamestore-online/${repo}:ref:refs/heads/main`,
    repository: `freegamestore-online/${repo}`,
    repository_owner: 'freegamestore-online',
    repository_owner_id: GAME_ORG_ID,
    repository_id: repoId,
    ref: 'refs/heads/main',
    event_name: 'push',
    job_workflow_ref: `freegamestore-online/ci-workflows/.github/workflows/game-deploy.yml@${'a'.repeat(40)}`,
    sha: 'abc1234',
    run_id: '1',
    jti: `jti-${++jtiSeq}`,
    iat: now,
    nbf: now,
    exp: now + 300,
    ...claims,
  });
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    priv,
    new TextEncoder().encode(`${h}.${p}`),
  );
  return `${h}.${p}.${b64url(new Uint8Array(sig))}`;
}

function memoryBucket() {
  const objects = new Map<string, Uint8Array>();
  const bucket = {
    async put(key: string, body: ReadableStream | string | null) {
      const bytes =
        typeof body === 'string'
          ? new TextEncoder().encode(body)
          : new Uint8Array(await new Response(body).arrayBuffer());
      objects.set(key, bytes);
      return { key, size: bytes.byteLength };
    },
    async list({ prefix }: { prefix: string }) {
      return {
        objects: [...objects]
          .filter(([k]) => k.startsWith(prefix))
          .map(([key, v]) => ({ key, size: v.byteLength })),
        truncated: false,
      };
    },
    async delete(keys: string | string[]) {
      for (const k of [keys].flat()) objects.delete(k);
    },
  };
  return { objects, bucket: bucket as unknown as R2Bucket };
}

describe('keyless game deploys (/v1/deploys)', () => {
  let db: Db;
  let store: ReturnType<typeof memoryBucket>;
  const env = () => ({ DB: d1(db), GAMES: store.bucket, GITHUB_TOKEN: 't' }) as unknown as Env;
  const request = (path: string, init: RequestInit) =>
    handleDeploy(new Request(`https://admin.freegamestore.online${path}`, init), env()).then(
      (r) => r!,
    );

  beforeEach(() => {
    _resetJwksCache();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ keys: [jwk] }))),
    );
    db = new DatabaseSync(':memory:');
    for (const m of ['0001_create_routes.sql', '0004_routes_release.sql', '0005_game_deploys.sql'])
      db.exec(migration(m));
    registry.games = [];
    for (const id of ['alpha', 'beta']) {
      registry.games.push({ id, repo: `freegamestore-online/${id}` });
      db.prepare(
        "INSERT INTO routes (slug, zone, r2_prefix, store, created_at, updated_at) VALUES (?, 'freegamestore.online', ?, 'games', 1, 1)",
      ).run(id, `games/${id}`);
    }
    store = memoryBucket();
  });
  afterEach(() => vi.unstubAllGlobals());

  const open = async (token: string, files: Record<string, number>) =>
    request('/v1/deploys', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ files }),
    });
  const put = (id: string, token: string, path: string, body: string) =>
    request(`/v1/deploys/${id}/files/${path.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Length': String(body.length) },
      body,
    });
  const commit = (id: string, token: string) =>
    request(`/v1/deploys/${id}/commit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  const release = (slug: string) =>
    (
      db.prepare('SELECT release FROM routes WHERE slug = ?').get(slug) as {
        release: string | null;
      }
    ).release;

  async function deploy(repo: string, repoId: string, files: Record<string, string>) {
    const sizes = Object.fromEntries(Object.entries(files).map(([p, b]) => [p, b.length]));
    const res = await open(await oidc(repo, repoId), sizes);
    expect(res.status).toBe(201);
    const session = (await res.json()) as { id: string; token: string; game_id: string };
    for (const [p, b] of Object.entries(files))
      expect((await put(session.id, session.token, p, b)).status).toBe(204);
    return { session, committed: await commit(session.id, session.token) };
  }

  it('uploads under the game release prefix, then switches the route atomically', async () => {
    const { session, committed } = await deploy('alpha', '101', {
      'index.html': '<script src="/assets/a.js"></script>',
      'assets/a.js': 'x',
      'my photo.png': 'p',
    });
    expect(committed.status).toBe(200);
    expect(session.game_id).toBe('alpha');
    expect(release('alpha')).toBe(session.id);
    expect(store.objects.has(`games/alpha/.r/${session.id}/assets/a.js`)).toBe(true);
    expect(store.objects.has(`games/alpha/.r/${session.id}/my photo.png`)).toBe(true);
    expect([...store.objects.keys()].every((k) => k.startsWith('games/alpha/'))).toBe(true);
  });

  it('keeps the previous release for rollback and deletes older ones', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++)
      ids.push((await deploy('alpha', '101', { 'index.html': `v${i}` })).session.id);
    expect(release('alpha')).toBe(ids[2]);
    const has = (id: string) => store.objects.has(`games/alpha/.r/${id}/index.html`);
    // Within the grace a host isolate's cached route can still serve v0.
    expect(has(ids[0]!)).toBe(true);
    db.prepare('UPDATE game_deploys SET committed_at = committed_at - 3600000').run();
    expect(await pruneDeploys(env())).toBe(1);
    expect(has(ids[0]!)).toBe(false);
    expect(has(ids[1]!) && has(ids[2]!)).toBe(true);
  });

  it('a session pruned while it commits can never become the release', async () => {
    const s = (await (await open(await oidc('alpha', '101'), { 'index.html': 1 })).json()) as {
      id: string;
      token: string;
    };
    await put(s.id, s.token, 'index.html', 'x');
    db.prepare("UPDATE game_deploys SET status = 'deleted' WHERE id = ?").run(s.id);
    expect((await commit(s.id, s.token)).status).toBe(409);
    expect(release('alpha')).toBeNull();
  });

  it('a route re-created by reconcile keeps serving the live release', async () => {
    const { session } = await deploy('alpha', '101', { 'index.html': 'live' });
    db.prepare("DELETE FROM routes WHERE slug = 'alpha'").run();
    const step = await insertHostRoute({ DB: d1(db) } as never, 'alpha');
    expect(step.status).toBe('ok');
    expect(release('alpha')).toBe(session.id);
  });

  it('never serves a half-uploaded deploy', async () => {
    await deploy('alpha', '101', { 'index.html': 'old' });
    const live = release('alpha');
    const res = await open(await oidc('alpha', '101'), { 'index.html': 3, 'assets/b.js': 1 });
    const s = (await res.json()) as { id: string; token: string };
    await put(s.id, s.token, 'index.html', 'new');
    expect((await commit(s.id, s.token)).status).toBe(409);
    expect(release('alpha')).toBe(live);
  });

  describe('repository A can never write game B', () => {
    beforeEach(async () => {
      await deploy('alpha', '101', { 'index.html': 'a' });
      await deploy('beta', '202', { 'index.html': 'b' });
    });

    it('a repo renamed to B still deploys only to the game its id is pinned to', async () => {
      const { session } = await deploy('beta', '101', { 'index.html': 'evil' });
      expect(session.game_id).toBe('alpha');
      expect(
        new TextDecoder().decode(store.objects.get(`games/beta/.r/${release('beta')}/index.html`)),
      ).toBe('b');
    });

    it('a recreated or reused repo name with a different repository_id is refused', async () => {
      const res = await open(await oidc('beta', '999'), { 'index.html': 1 });
      expect(res.status).toBe(403);
      expect(await res.text()).toMatch(/another repository/);
    });

    it("A's upload token cannot write into B's deploy, and paths cannot climb out", async () => {
      const a = (await (await open(await oidc('alpha', '101'), { 'index.html': 1 })).json()) as {
        id: string;
        token: string;
      };
      const b = (await (await open(await oidc('beta', '202'), { 'index.html': 1 })).json()) as {
        id: string;
        token: string;
      };
      expect((await put(b.id, a.token, 'index.html', 'x')).status).toBe(401);
      const climb = await request(`/v1/deploys/${a.id}/files/..%2F..%2Fbeta%2Findex.html`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${a.token}`, 'Content-Length': '1' },
        body: 'x',
      });
      expect(climb.status).toBe(400);
      expect(
        (await open(await oidc('alpha', '101'), { '../beta/index.html': 1, 'index.html': 1 }))
          .status,
      ).toBe(400);
      expect(
        (await open(await oidc('alpha', '101'), { '/etc/x.html': 1, 'index.html': 1 })).status,
      ).toBe(400);
    });
  });

  it.each([
    ['another org', { repository_owner_id: '1', repository_owner: 'evil' }, 403],
    ['a branch other than main', { ref: 'refs/heads/feature' }, 403],
    ['a pull_request event', { event_name: 'pull_request' }, 403],
    [
      'a workflow that skips the game-deploy pipeline',
      {
        job_workflow_ref: 'freegamestore-online/alpha/.github/workflows/deploy.yml@refs/heads/main',
      },
      403,
    ],
    [
      'the legacy game-ci pipeline',
      {
        job_workflow_ref:
          'freegamestore-online/ci-workflows/.github/workflows/game-ci.yml@refs/heads/main',
      },
      403,
    ],
    ['another audience', { aud: 'https://api.proappstore.online' }, 401],
    ['an expired token', { exp: Math.floor(Date.now() / 1000) - 120 }, 401],
    ['a not-yet-valid token', { nbf: Math.floor(Date.now() / 1000) + 600 }, 401],
  ])('refuses %s', async (_name, claims, status) => {
    expect((await open(await oidc('alpha', '101', claims), { 'index.html': 1 })).status).toBe(
      status,
    );
  });

  it('pins a first deploy only to a game whose registry repo agrees', async () => {
    registry.games = [{ id: 'alpha', repo: 'freegamestore-online/other' }];
    const res = await open(await oidc('alpha', '101'), { 'index.html': 1 });
    expect(res.status).toBe(403);
    expect(await res.text()).toMatch(/registered to/);
  });

  it('accepts a registry repo recorded as a GitHub URL', async () => {
    registry.games = [{ id: 'alpha', repo: 'https://github.com/freegamestore-online/alpha' }];
    expect((await open(await oidc('alpha', '101'), { 'index.html': 1 })).status).toBe(201);
  });

  it('refuses an unregistered repository', async () => {
    expect((await open(await oidc('gamma', '303'), { 'index.html': 1 })).status).toBe(403);
  });

  it('refuses a replayed token (jti)', async () => {
    const token = await oidc('alpha', '101');
    expect((await open(token, { 'index.html': 1 })).status).toBe(201);
    expect((await open(token, { 'index.html': 1 })).status).toBe(409);
  });

  it('rate-limits deploys per game', async () => {
    const insert = db.prepare(
      `INSERT INTO game_deploys (id, game_id, jti, repository_id, token_hash, manifest, total_bytes,
         status, created_at, expires_at) VALUES (?, 'alpha', ?, '101', 'h', '{}', 0, 'deleted', ?, 0)`,
    );
    for (let i = 0; i < 20; i++) insert.run(`old${i}`, `old-jti-${i}`, Date.now() - 1000);
    expect((await open(await oidc('alpha', '101'), { 'index.html': 1 })).status).toBe(429);
    expect((await open(await oidc('beta', '202'), { 'index.html': 1 })).status).toBe(201);
  });

  it('caps uncommitted uploads per game', async () => {
    for (let i = 0; i < 3; i++)
      expect((await open(await oidc('alpha', '101'), { 'index.html': 1 })).status).toBe(201);
    const res = await open(await oidc('alpha', '101'), { 'index.html': 1 });
    expect(res.status).toBe(429);
    expect(await res.text()).toMatch(/already uploading/);
  });

  it('an older run that commits after a newer one cannot replace it', async () => {
    const older = (await (await open(await oidc('alpha', '101'), { 'index.html': 3 })).json()) as {
      id: string;
      token: string;
    };
    await put(older.id, older.token, 'index.html', 'old');
    const { session } = await deploy('alpha', '101', { 'index.html': 'new' });
    expect((await commit(older.id, older.token)).status).toBe(409);
    expect(release('alpha')).toBe(session.id);
  });

  it('the daily prune drops abandoned uploads but never a served release', async () => {
    const { session } = await deploy('alpha', '101', { 'index.html': 'live' });
    const s = (await (await open(await oidc('alpha', '101'), { 'index.html': 4 })).json()) as {
      id: string;
      token: string;
    };
    await put(s.id, s.token, 'index.html', 'half');
    db.prepare('UPDATE game_deploys SET expires_at = 0 WHERE id = ?').run(s.id);
    expect(await pruneDeploys(env())).toBe(1);
    expect(store.objects.has(`games/alpha/.r/${s.id}/index.html`)).toBe(false);
    expect(store.objects.has(`games/alpha/.r/${session.id}/index.html`)).toBe(true);
  });

  it('refuses oversize files, wrong lengths and files outside the manifest', async () => {
    expect(
      (await open(await oidc('alpha', '101'), { 'index.html': 1, 'big.bin': 26 * 1024 * 1024 }))
        .status,
    ).toBe(413);
    const s = (await (await open(await oidc('alpha', '101'), { 'index.html': 5 })).json()) as {
      id: string;
      token: string;
    };
    expect((await put(s.id, s.token, 'index.html', 'abc')).status).toBe(400);
    expect((await put(s.id, s.token, 'other.js', 'abcde')).status).toBe(400);
  });
});

describe('contentTypeFor', () => {
  it.each([
    ['index.html', 'text/html; charset=utf-8'],
    ['assets/app-1a2b.js', 'text/javascript; charset=utf-8'],
    ['.well-known/assetlinks.json', 'application/json'],
    ['.buildinfo.json', 'application/json'],
    ['CNAME', 'application/octet-stream'],
    ['sounds/hit.OGG', 'audio/ogg'],
    ["fonts/Café Noir's #1 [b].woff2", 'font/woff2'],
    ['models/brain.onnx', 'application/octet-stream'],
  ])('allows %s', (path, type) => expect(contentTypeFor(path)).toBe(type));
  it.each([
    '../x.html',
    'a/../b.js',
    '/abs.js',
    'a//b.js',
    'a\\b.js',
    'run.sh',
    'x.php',
    'a/./b.js',
    '',
  ])('refuses %s', (path) => expect(contentTypeFor(path)).toBeNull());
});
