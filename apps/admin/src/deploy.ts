import type { Env } from './env';
import { type OidcClaims, verifyGithubOidc } from './github-oidc';
import { readRegistry } from './registryReader';

/**
 * Keyless game deploys (#488, #438). A game repo's deploy job authenticates with
 * a GitHub Actions OIDC token instead of the shared org R2 key, and the build
 * output reaches R2 only through this Worker's binding, under that game's prefix.
 * The same protocol as freeappstore-online/platform packages/backend/src/routes/deploy.ts:
 *
 *   POST /v1/deploys                 OIDC token + manifest {path: bytes} -> {id, token}
 *   PUT  /v1/deploys/:id/files/<p>   one file, streamed to games/<game>/.r/<id>/<p>
 *   POST /v1/deploys/:id/commit      every manifest file present -> routes.release = id
 *
 * The host Worker serves `games/<game>/.r/<release>/` once a release is set, so
 * a deploy that fails half way never serves a mix of old and new files.
 */

export const DEPLOY_AUDIENCE = 'https://admin.freegamestore.online';
/** freegamestore-online's immutable org id: a renamed or recreated org cannot match. */
export const GAME_ORG_ID = '281560447';
const DEPLOY_REF = 'refs/heads/main';
const DEPLOY_EVENTS = new Set(['push', 'workflow_dispatch']);
const SESSION_TTL_MS = 15 * 60 * 1000;
const DEPLOYS_PER_HOUR = 20;
const OPEN_DEPLOYS = 3;
const PRUNE_GRACE_MS = 10 * 60 * 1000;
const DEPLOY_WORKFLOW = 'freegamestore-online/ci-workflows/.github/workflows/game-deploy.yml@';
export const MAX_FILES = 5000;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 250 * 1024 * 1024;

export class DeployError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const CONTENT_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  cjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json',
  map: 'application/json',
  webmanifest: 'application/manifest+json',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  tsv: 'text/tab-separated-values; charset=utf-8',
  xml: 'application/xml',
  yaml: 'text/yaml; charset=utf-8',
  yml: 'text/yaml; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  wasm: 'application/wasm',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  opus: 'audio/opus',
  mid: 'audio/midi',
  midi: 'audio/midi',
  mp4: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  pdf: 'application/pdf',
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  obj: 'text/plain; charset=utf-8',
  mtl: 'text/plain; charset=utf-8',
  bin: 'application/octet-stream',
  data: 'application/octet-stream',
  atlas: 'text/plain; charset=utf-8',
  fnt: 'text/plain; charset=utf-8',
  ktx2: 'image/ktx2',
  basis: 'application/octet-stream',
  hdr: 'application/octet-stream',
  zip: 'application/zip',
  gz: 'application/gzip',
  br: 'application/octet-stream',
  onnx: 'application/octet-stream',
  tflite: 'application/octet-stream',
  pck: 'application/octet-stream',
  pak: 'application/octet-stream',
  dat: 'application/octet-stream',
  ttc: 'font/collection',
  vtt: 'text/vtt; charset=utf-8',
  srt: 'text/plain; charset=utf-8',
  jsonl: 'application/jsonl',
  ndjson: 'application/x-ndjson',
  wgsl: 'text/plain; charset=utf-8',
  glsl: 'text/plain; charset=utf-8',
  frag: 'text/plain; charset=utf-8',
  vert: 'text/plain; charset=utf-8',
  heic: 'image/heic',
  heif: 'image/heif',
  jxl: 'image/jxl',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  apng: 'image/apng',
  cur: 'image/x-icon',
  mov: 'video/quicktime',
  m4v: 'video/mp4',
  weba: 'audio/webm',
  stl: 'model/stl',
  usdz: 'model/vnd.usdz+zip',
  ply: 'application/octet-stream',
  fbx: 'application/octet-stream',
  ktx: 'image/ktx',
  dds: 'application/octet-stream',
  exr: 'image/aces',
  epub: 'application/epub+zip',
  ics: 'text/calendar; charset=utf-8',
  rss: 'application/rss+xml',
  atom: 'application/atom+xml',
  xsl: 'application/xml',
  toml: 'text/plain; charset=utf-8',
  ini: 'text/plain; charset=utf-8',
  log: 'text/plain; charset=utf-8',
  license: 'text/plain; charset=utf-8',
  pem: 'text/plain; charset=utf-8',
  asc: 'text/plain; charset=utf-8',
  sig: 'application/octet-stream',
};

/**
 * A repo-relative build-output path: no absolute paths, no `.`/`..` segments,
 * no backslashes, quotes or control characters, and an allowed file extension
 * (or none). Executable/server-side types (.php, .sh, .exe, …) are refused.
 * Returns the content type to store, or null when the path is refused.
 */
export function contentTypeFor(path: string): string | null {
  if (path.length === 0 || path.length > 512) return null;
  const segments = path.split('/');
  if (
    segments.some(
      (s) => !/^[\p{L}\p{M}\p{N} _.@~+=,()!'&#%[\]$-]+$/u.test(s) || s === '.' || s === '..',
    )
  )
    return null;
  const name = segments[segments.length - 1]!;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return 'application/octet-stream';
  return CONTENT_TYPES[name.slice(dot + 1).toLowerCase()] ?? null;
}

/** The manifest problems, or the parsed {path: bytes} map. */
export function parseManifest(body: unknown): { files: Record<string, number>; total: number } {
  const files = (body as { files?: unknown } | null)?.files;
  if (!files || typeof files !== 'object' || Array.isArray(files))
    throw new DeployError(400, 'body must be {"files": {"<path>": <bytes>}}');
  const entries = Object.entries(files as Record<string, unknown>);
  if (entries.length === 0) throw new DeployError(400, 'build output is empty');
  if (entries.length > MAX_FILES) throw new DeployError(413, `more than ${MAX_FILES} files`);
  if (!entries.some(([path]) => path === 'index.html'))
    throw new DeployError(400, 'build output has no index.html');
  let total = 0;
  for (const [path, size] of entries) {
    if (contentTypeFor(path) === null) throw new DeployError(400, `path refused: ${path}`);
    if (!Number.isSafeInteger(size) || (size as number) < 0)
      throw new DeployError(400, `bad size for ${path}`);
    if ((size as number) > MAX_FILE_BYTES)
      throw new DeployError(413, `${path} is larger than ${MAX_FILE_BYTES} bytes`);
    total += size as number;
  }
  if (total > MAX_TOTAL_BYTES)
    throw new DeployError(413, `build is larger than ${MAX_TOTAL_BYTES} bytes`);
  return { files: files as Record<string, number>, total };
}

/** `owner/name` from a stored repo reference, which may be a GitHub URL. */
export function repoName(ref: string): string {
  return ref
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomHex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function bearer(header: string | null): string {
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new DeployError(401, 'missing bearer token');
  return token;
}

/**
 * Authorize on immutable claims: the org id, main, an allowed event, and the
 * repository id pinned to exactly one game. The first deploy of an unpinned game
 * pins it, but only for the same-named repo in the verified org (the org alone
 * creates repos there), only for a provisioned game (a D1 route), and only if
 * the registry entry's repo, when set, agrees.
 */
export async function resolveDeployGame(env: Env, claims: OidcClaims): Promise<string> {
  if (claims.repository_owner_id !== GAME_ORG_ID)
    throw new DeployError(
      403,
      `repository owner ${claims.repository_owner} is not freegamestore-online`,
    );
  if (claims.ref !== DEPLOY_REF)
    throw new DeployError(403, `ref ${claims.ref ?? '(none)'} may not deploy; only ${DEPLOY_REF}`);
  if (!DEPLOY_EVENTS.has(claims.event_name ?? ''))
    throw new DeployError(403, `event ${claims.event_name ?? '(none)'} may not deploy`);
  if (!claims.repository_id || !claims.jti)
    throw new DeployError(401, 'token lacks repository_id or jti');
  // Only the reusable game-deploy pipeline may deploy, so the `fgs check`
  // compliance gate and the smoke test always run before a release goes live.
  if (!claims.job_workflow_ref?.startsWith(DEPLOY_WORKFLOW))
    throw new DeployError(403, `workflow ${claims.job_workflow_ref ?? '(none)'} may not deploy`);

  const pinned = await env.DB.prepare(
    'SELECT game_id FROM game_repositories WHERE repository_id = ?',
  )
    .bind(claims.repository_id)
    .first<{ game_id: string }>();
  if (pinned) return pinned.game_id;

  const gameId = (claims.repository.split('/')[1] ?? '').toLowerCase();
  const route = await env.DB.prepare(
    `SELECT p.repository_id AS pinned_to FROM routes r
       LEFT JOIN game_repositories p ON p.game_id = ?1
      WHERE r.r2_prefix = ?2 AND r.store = 'games' AND r.hosted_on = 'r2' LIMIT 1`,
  )
    .bind(gameId, `games/${gameId}`)
    .first<{ pinned_to: string | null }>();
  if (!route)
    throw new DeployError(403, `repository ${claims.repository} is not a provisioned game`);
  if (route.pinned_to) throw new DeployError(403, `game ${gameId} deploys from another repository`);
  const registry = await readRegistry(env.GITHUB_TOKEN);
  if (registry.status !== 'available')
    throw new DeployError(503, 'games registry unavailable; retry');
  const entry = registry.games.find((g) => g.id === gameId);
  if (!entry) throw new DeployError(403, `game ${gameId} is not in the registry`);
  if (typeof entry.repo === 'string' && repoName(entry.repo) !== repoName(claims.repository))
    throw new DeployError(403, `game ${gameId} is registered to ${entry.repo}`);
  // Two first deploys can race (a push and a dispatch): the first pin wins.
  await env.DB.prepare(
    `INSERT INTO game_repositories (game_id, repository_id, repository, pinned_at) VALUES (?, ?, ?, ?)
     ON CONFLICT DO NOTHING`,
  )
    .bind(gameId, claims.repository_id, claims.repository, Date.now())
    .run();
  const won = await env.DB.prepare(
    'SELECT 1 AS ok FROM game_repositories WHERE game_id = ? AND repository_id = ?',
  )
    .bind(gameId, claims.repository_id)
    .first();
  if (!won) throw new DeployError(403, `game ${gameId} deploys from another repository`);
  return gameId;
}

interface DeployRow {
  id: string;
  game_id: string;
  token_hash: string;
  manifest: string;
  status: string;
  created_at: number;
  expires_at: number;
}

async function openDeploy(env: Env, id: string, authorization: string | null) {
  const token = bearer(authorization);
  const row = await env.DB.prepare(
    'SELECT id, game_id, token_hash, manifest, status, created_at, expires_at FROM game_deploys WHERE id = ?',
  )
    .bind(id)
    .first<DeployRow>();
  if (!row || row.token_hash !== (await sha256Hex(token)))
    throw new DeployError(401, 'unknown deploy or upload token');
  if (row.status !== 'open') throw new DeployError(409, `deploy is ${row.status}`);
  if (row.expires_at < Date.now()) throw new DeployError(410, 'deploy session expired');
  return { row, files: JSON.parse(row.manifest) as Record<string, number> };
}

function bucketOf(env: Env): R2Bucket {
  if (!env.GAMES) throw new DeployError(503, 'game storage not configured');
  return env.GAMES;
}

const releasePrefix = (gameId: string, id: string) => `games/${gameId}/.r/${id}/`;

async function deletePrefix(bucket: R2Bucket, prefix: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const listed = await bucket.list(cursor ? { prefix, cursor } : { prefix });
    if (listed.objects.length) await bucket.delete(listed.objects.map((o) => o.key));
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

/**
 * Delete the R2 files of deploys no route serves: abandoned sessions past their
 * expiry, and superseded releases except each game's latest (kept for rollback,
 * and for host isolates that still cache the previous route for up to a minute).
 * Runs after every commit (one game) and from the hourly cron (all games).
 */
export async function pruneDeploys(env: Env, gameId?: string, limit = 5): Promise<number> {
  if (!env.GAMES) return 0;
  // Grace: an expired session may still be mid-commit, and a host isolate (60s
  // route cache) or a page cached just before a switch may still ask for the
  // release before last.
  const cutoff = Date.now() - PRUNE_GRACE_MS;
  const stale = await env.DB.prepare(
    `SELECT d.id, d.game_id FROM game_deploys d
      WHERE (?1 IS NULL OR d.game_id = ?1)
        AND d.id NOT IN (SELECT release FROM routes WHERE release IS NOT NULL)
        AND ((d.status = 'open' AND d.expires_at < ?2)
          OR (d.status = 'superseded'
              AND d.id != (SELECT s.id FROM game_deploys s
                            WHERE s.game_id = d.game_id AND s.status = 'superseded'
                            ORDER BY s.created_at DESC, s.rowid DESC LIMIT 1)
              AND NOT EXISTS (SELECT 1 FROM game_deploys l WHERE l.game_id = d.game_id
                               AND l.status = 'live' AND l.committed_at > ?2)))
      ORDER BY d.created_at LIMIT ?3`,
  )
    .bind(gameId ?? null, cutoff, limit)
    .all<{ id: string; game_id: string }>();
  for (const old of stale.results) {
    // Mark first, so a commit racing this prune can no longer switch to it.
    await env.DB.prepare("UPDATE game_deploys SET status = 'deleted' WHERE id = ?")
      .bind(old.id)
      .run();
    await deletePrefix(env.GAMES, releasePrefix(old.game_id, old.id));
  }
  return stale.results.length;
}

async function openSession(request: Request, env: Env): Promise<Response> {
  let claims: OidcClaims;
  try {
    claims = await verifyGithubOidc(bearer(request.headers.get('Authorization')), {
      audience: DEPLOY_AUDIENCE,
    });
  } catch (e) {
    if (e instanceof DeployError) throw e;
    throw new DeployError(401, `OIDC verification failed: ${(e as Error).message}`);
  }
  const { files, total } = parseManifest(await request.json().catch(() => null));
  const gameId = await resolveDeployGame(env, claims);
  bucketOf(env);

  const now = Date.now();
  const recent = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM game_deploys WHERE game_id = ? AND created_at > ?',
  )
    .bind(gameId, now - 3600_000)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= DEPLOYS_PER_HOUR)
    throw new DeployError(429, `more than ${DEPLOYS_PER_HOUR} deploys of ${gameId} this hour`);
  // Uncommitted uploads hold R2 space until they expire: bound them per game.
  const pending = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM game_deploys WHERE game_id = ? AND status = 'open' AND expires_at > ?",
  )
    .bind(gameId, now)
    .first<{ n: number }>();
  if ((pending?.n ?? 0) >= OPEN_DEPLOYS)
    throw new DeployError(429, `${OPEN_DEPLOYS} deploys of ${gameId} are already uploading`);

  const id = randomHex(12);
  const token = randomHex(32);
  try {
    await env.DB.prepare(
      `INSERT INTO game_deploys (id, game_id, jti, repository_id, sha, run_id, token_hash, manifest,
         total_bytes, status, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
    )
      .bind(
        id,
        gameId,
        claims.jti!,
        claims.repository_id!,
        claims.sha ?? null,
        claims.run_id ?? null,
        await sha256Hex(token),
        JSON.stringify(files),
        total,
        now,
        now + SESSION_TTL_MS,
      )
      .run();
  } catch (e) {
    if (/UNIQUE/i.test((e as Error).message)) throw new DeployError(409, 'OIDC token already used');
    throw e;
  }
  console.log(`deploy ${id} opened for ${gameId} by ${claims.repository} run ${claims.run_id}`);
  return Response.json(
    { id, token, game_id: gameId, expires_at: now + SESSION_TTL_MS },
    { status: 201 },
  );
}

async function putFile(request: Request, env: Env, id: string, rawPath: string): Promise<Response> {
  const { row, files } = await openDeploy(env, id, request.headers.get('Authorization'));
  let path: string;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    throw new DeployError(400, 'malformed path');
  }
  const expected = files[path];
  if (expected === undefined) throw new DeployError(400, `${path} is not in the manifest`);
  if (Number(request.headers.get('Content-Length')) !== expected)
    throw new DeployError(400, `${path}: Content-Length must be ${expected}`);
  const key = `${releasePrefix(row.game_id, id)}${path}`;
  const bucket = bucketOf(env);
  const put = await bucket.put(key, expected === 0 ? '' : request.body, {
    httpMetadata: { contentType: contentTypeFor(path)! },
  });
  if (put?.size !== expected) {
    await bucket.delete(key);
    throw new DeployError(400, `${path}: received ${put?.size} bytes, expected ${expected}`);
  }
  return new Response(null, { status: 204 });
}

async function commit(request: Request, env: Env, id: string): Promise<Response> {
  const { row, files } = await openDeploy(env, id, request.headers.get('Authorization'));
  const bucket = bucketOf(env);
  const prefix = releasePrefix(row.game_id, id);
  const stored = new Map<string, number>();
  let cursor: string | undefined;
  do {
    const listed = await bucket.list(cursor ? { prefix, cursor } : { prefix });
    for (const o of listed.objects) stored.set(o.key.slice(prefix.length), o.size);
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  const missing = Object.entries(files).filter(([path, size]) => stored.get(path) !== size);
  if (missing.length)
    throw new DeployError(
      409,
      `${missing.length} file(s) missing or incomplete, e.g. ${missing[0]![0]}`,
    );

  // One transaction: switch the route unless a newer deploy is already live (a
  // slower, older run must not replace it), and record the switch with it.
  const now = Date.now();
  const gamePrefix = `games/${row.game_id}`;
  const switched = await env.DB.batch([
    env.DB.prepare(
      `UPDATE routes SET release = ?, updated_at = ? WHERE r2_prefix = ? AND hosted_on = 'r2'
         AND EXISTS (SELECT 1 FROM game_deploys WHERE id = ? AND status = 'open')
         AND NOT EXISTS (SELECT 1 FROM game_deploys
                          WHERE game_id = ? AND status = 'live' AND created_at > ?)`,
    ).bind(id, now, gamePrefix, id, row.game_id, row.created_at),
    env.DB.prepare(
      `UPDATE game_deploys SET status = 'superseded' WHERE game_id = ? AND status = 'live'
         AND EXISTS (SELECT 1 FROM routes WHERE r2_prefix = ? AND release = ?)`,
    ).bind(row.game_id, gamePrefix, id),
    env.DB.prepare(
      `UPDATE game_deploys SET status = 'live', committed_at = ? WHERE id = ?
         AND EXISTS (SELECT 1 FROM routes WHERE r2_prefix = ? AND release = ?)`,
    ).bind(now, id, gamePrefix, id),
  ]);
  if (!switched[0]?.meta.changes)
    throw new DeployError(409, 'a newer deploy is already live, or the game has no route');

  await pruneDeploys(env, row.game_id);
  console.log(`deploy ${id} live for ${row.game_id} (${Object.keys(files).length} files)`);
  return Response.json({ game_id: row.game_id, release: id, files: Object.keys(files).length });
}

/** Answers /v1/deploys/*, or null for any other path. No cookies: bearer tokens only. */
export async function handleDeploy(request: Request, env: Env): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (pathname !== '/v1/deploys' && !pathname.startsWith('/v1/deploys/')) return null;
  try {
    if (pathname === '/v1/deploys' && request.method === 'POST')
      return await openSession(request, env);
    const file = /^\/v1\/deploys\/([0-9a-f]{24})\/files\/(.+)$/.exec(pathname);
    if (file && request.method === 'PUT') return await putFile(request, env, file[1]!, file[2]!);
    const done = /^\/v1\/deploys\/([0-9a-f]{24})\/commit$/.exec(pathname);
    if (done && request.method === 'POST') return await commit(request, env, done[1]!);
    return Response.json({ error: 'not found' }, { status: 404 });
  } catch (e) {
    if (e instanceof DeployError) return Response.json({ error: e.message }, { status: e.status });
    console.error('deploy error:', e);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}
