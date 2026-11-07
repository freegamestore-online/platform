/**
 * The create canary's keyless session exchange (#531): POST /canary/session
 * trades a GitHub Actions OIDC token for a 15-minute, canary-only fgs_token, and
 * every other route of this worker refuses that token.
 *
 * Runs against real SQLite (test/sqlite-d1.ts), so the single-use jti set and the
 * daily create cap are exercised as written.
 */
import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';

import {
  CANARY_AUDIENCE,
  CANARY_OWNER_ID,
  CANARY_REPOSITORY_ID,
  CANARY_SUB,
  CANARY_WORKFLOW_REF,
} from '../../../contracts/canary-session/v1/contract';
import { _resetJwksCache } from '../../../contracts/github-oidc/v1/contract';
import { sqliteD1 } from '../test/sqlite-d1';
import worker, { handleCanaryAuthorize, handleCanarySession, jwtSign, jwtVerify } from './index';

const SECRET = 'canary-test-secret';
const KID = 'test-key';
const ISSUER = 'https://token.actions.githubusercontent.com';

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const b64json = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));

const rsa = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
let priv: CryptoKey;
let otherPriv: CryptoKey;
let jwks: { keys: unknown[] };
const realFetch = globalThis.fetch;

before(async () => {
  const pair = (await crypto.subtle.generateKey(rsa, true, ['sign', 'verify'])) as CryptoKeyPair;
  priv = pair.privateKey;
  otherPriv = ((await crypto.subtle.generateKey(rsa, true, ['sign', 'verify'])) as CryptoKeyPair).privateKey;
  jwks = {
    keys: [{ ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: KID, alg: 'RS256', use: 'sig' }],
  };
});

const jwksFetch = (async () => Response.json(jwks)) as unknown as typeof fetch;

beforeEach(() => {
  _resetJwksCache();
  globalThis.fetch = realFetch;
});

let seq = 0;
/** A token as the canary workflow would get it, with `claims` overriding any field. */
async function oidc(claims: Record<string, unknown> = {}, key = priv): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const h = b64json({ alg: 'RS256', typ: 'JWT', kid: KID });
  const p = b64json({
    iss: ISSUER,
    aud: CANARY_AUDIENCE,
    sub: 'repo:freegamestore-online/platform:ref:refs/heads/main',
    repository: 'freegamestore-online/platform',
    repository_owner: 'freegamestore-online',
    repository_id: CANARY_REPOSITORY_ID,
    repository_owner_id: CANARY_OWNER_ID,
    ref: 'refs/heads/main',
    event_name: 'workflow_dispatch',
    job_workflow_ref: CANARY_WORKFLOW_REF,
    run_id: '1',
    jti: `jti-${++seq}-${Math.random()}`,
    iat: now,
    nbf: now,
    exp: now + 300,
    ...claims,
  });
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(new Uint8Array(sig))}`;
}

type Env = Parameters<typeof handleCanarySession>[1];
const newEnv = (users: string[] = []) => ({ JWT_SECRET: SECRET, DB: sqliteD1(users) }) as unknown as Env;

const exchange = (env: Env, token?: string, now?: number) =>
  handleCanarySession(
    new Request('https://auth.freegamestore.online/canary/session', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }),
    env,
    { fetchImpl: jwksFetch, ...(now ? { now } : {}) },
  );

async function refusedWith(res: Response, reason: string) {
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: 'forbidden', reason });
}

test('a valid canary token gets a 15-minute session for the canary sub and nothing else', async () => {
  const res = await exchange(newEnv(), await oidc());
  assert.equal(res.status, 200);
  const { token } = (await res.json()) as { token: string };
  const claims = await jwtVerify(token, SECRET);
  assert.equal(claims?.sub, CANARY_SUB);
  assert.equal(claims?.canary, true);
  assert.equal((claims?.exp as number) - (claims?.iat as number), 900);
  for (const absent of ['email', 'avatar', 'login', 'name'])
    assert.equal(claims?.[absent], undefined, `no ${absent} claim`);
});

test('the schedule event is accepted too', async () => {
  assert.equal((await exchange(newEnv(), await oidc({ event_name: 'schedule' }))).status, 200);
});

test('refused: a call with no token', async () => {
  await refusedWith(await exchange(newEnv()), 'missing_token');
});

test('refused: a wrong audience (the deploy audience is not the canary one)', async () => {
  await refusedWith(
    await exchange(newEnv(), await oidc({ aud: 'https://admin.freegamestore.online' })),
    'bad_audience',
  );
});

test('refused: another repository id, even under the platform name', async () => {
  await refusedWith(await exchange(newEnv(), await oidc({ repository_id: '999' })), 'wrong_repository');
  await refusedWith(
    await exchange(newEnv(), await oidc({ repository: 'freegamestore-online/chess', repository_id: '999' })),
    'wrong_repository',
  );
});

test('refused: another owner id', async () => {
  await refusedWith(await exchange(newEnv(), await oidc({ repository_owner_id: '1' })), 'wrong_owner');
});

test('refused: another workflow in this repository, a reusable one, or another ref of the file', async () => {
  for (const job_workflow_ref of [
    'freegamestore-online/platform/.github/workflows/ci.yml@refs/heads/main',
    `freegamestore-online/ci-workflows/.github/workflows/game-deploy.yml@${'a'.repeat(40)}`,
    'freegamestore-online/platform/.github/workflows/create-canary.yml@refs/heads/other',
    'freegamestore-online/platform/.github/workflows/create-canary.yml@refs/pull/1/merge',
  ])
    await refusedWith(await exchange(newEnv(), await oidc({ job_workflow_ref })), 'wrong_workflow');
});

test('refused: a ref other than main', async () => {
  await refusedWith(await exchange(newEnv(), await oidc({ ref: 'refs/heads/feature' })), 'wrong_ref');
  await refusedWith(await exchange(newEnv(), await oidc({ ref: 'refs/pull/1/merge' })), 'wrong_ref');
});

test('refused: an event other than workflow_dispatch or schedule', async () => {
  for (const event_name of ['push', 'pull_request', 'pull_request_target', 'workflow_run'])
    await refusedWith(await exchange(newEnv(), await oidc({ event_name })), 'wrong_event');
  await refusedWith(await exchange(newEnv(), await oidc({ event_name: undefined })), 'wrong_event');
});

test('refused: a replayed jti, and the first use still worked', async () => {
  const env = newEnv();
  const token = await oidc();
  assert.equal((await exchange(env, token)).status, 200);
  await refusedWith(await exchange(env, token), 'replay');
});

test('refused: an expired token', async () => {
  const past = Math.floor(Date.now() / 1000) - 3600;
  await refusedWith(await exchange(newEnv(), await oidc({ iat: past - 300, nbf: past - 300, exp: past })), 'expired');
});

test('refused: a bad signature (signed by another key, or tampered after signing)', async () => {
  await refusedWith(await exchange(newEnv(), await oidc({}, otherPriv)), 'bad_signature');
  const [h, p, s] = (await oidc()).split('.');
  const tampered = `${h}.${b64json({ ...JSON.parse(atob(p!.replace(/-/g, '+').replace(/_/g, '/'))), repository_id: '1' })}.${s}`;
  await refusedWith(await exchange(newEnv(), tampered), 'bad_signature');
});

test('refused: the wrong issuer, and a token that is not a JWT', async () => {
  await refusedWith(await exchange(newEnv(), await oidc({ iss: 'https://evil.example' })), 'bad_issuer');
  await refusedWith(await exchange(newEnv(), 'not-a-jwt'), 'bad_token');
});

test('refused: a token without a jti', async () => {
  await refusedWith(await exchange(newEnv(), await oidc({ jti: undefined })), 'missing_jti');
});

test('GitHub keys being unreachable is a 503, not a verdict on the token', async () => {
  const res = await handleCanarySession(
    new Request('https://auth.freegamestore.online/canary/session', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await oidc()}` },
    }),
    newEnv(),
    { fetchImpl: (async () => new Response('', { status: 500 })) as unknown as typeof fetch },
  );
  assert.equal(res.status, 503);
});

// --- /canary/authorize: what admin and the MCP ask ---

async function session(env: Env): Promise<string> {
  return ((await (await exchange(env, await oidc())).json()) as { token: string }).token;
}
const authorize = (env: Env, token: string, action: unknown, now?: number) =>
  handleCanaryAuthorize(
    new Request('https://auth.freegamestore.online/canary/authorize', {
      method: 'POST',
      headers: { 'X-FGS-Token': token },
      body: JSON.stringify({ action }),
    }),
    env,
    now ? { now } : {},
  );

test('authorize "verify" accepts a canary session any number of times', async () => {
  const env = newEnv();
  const token = await session(env);
  for (let i = 0; i < 6; i++) assert.equal((await authorize(env, token, 'verify')).status, 200);
});

test('authorize refuses what is not a live canary session', async () => {
  const env = newEnv(['github:1']);
  const user = await jwtSign({ sub: 'github:1', login: 'someone', exp: Math.floor(Date.now() / 1000) + 600 }, SECRET);
  assert.equal((await authorize(env, user, 'create')).status, 401);
  const expired = await jwtSign(
    { typ: 'fgs_canary', sub: CANARY_SUB, canary: true, exp: Math.floor(Date.now() / 1000) - 5 },
    SECRET,
  );
  assert.equal((await authorize(env, expired, 'verify')).status, 401);
  const wrongKey = await jwtSign({ typ: 'fgs_canary', sub: CANARY_SUB, canary: true, exp: 4e9 }, 'another-secret');
  assert.equal((await authorize(env, wrongKey, 'verify')).status, 401);
  // Marked as a canary but carrying a person's claims: not the shape the exchange mints.
  const mixed = await jwtSign(
    { typ: 'fgs_canary', sub: CANARY_SUB, canary: true, login: 'serge-ivo', exp: 4e9 },
    SECRET,
  );
  assert.equal((await authorize(env, mixed, 'verify')).status, 401);
  assert.equal((await authorize(env, await session(env), 'delete')).status, 400);
});

test('at most 4 canary creates a UTC day, then 429, then a new day opens', async () => {
  const env = newEnv();
  const token = await session(env);
  const day1 = Date.UTC(2026, 10, 8, 12);
  for (let i = 0; i < 4; i++) assert.equal((await authorize(env, token, 'create', day1)).status, 200);
  assert.equal((await authorize(env, token, 'create', day1)).status, 429);
  assert.equal((await authorize(env, token, 'create', day1 + 3600_000)).status, 429);
  assert.equal((await authorize(env, token, 'verify', day1)).status, 200, 'verify takes no slot');
  assert.equal((await authorize(env, token, 'create', Date.UTC(2026, 10, 9, 0, 0, 1))).status, 200);
});

// --- everything else refuses a canary session ---

async function viaWorker(env: Env, path: string, init: RequestInit & { token: string; cookie?: boolean }) {
  const { token, cookie, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (cookie) headers.set('Cookie', `__Host-fgs_token=${token}`);
  else headers.set('X-FGS-Token', token);
  return worker.fetch(new Request(`https://auth.freegamestore.online${path}`, { ...rest, headers }), env);
}

test('/me refuses a canary session with 403, as header or cookie', async () => {
  const env = newEnv();
  const token = await session(env);
  assert.equal((await viaWorker(env, '/me', { token })).status, 403);
  assert.equal((await viaWorker(env, '/v1/me', { token })).status, 403);
  assert.equal((await viaWorker(env, '/me', { token, cookie: true })).status, 403);
  const bearer = await worker.fetch(
    new Request('https://auth.freegamestore.online/me', { headers: { Authorization: `Bearer ${token}` } }),
    env,
  );
  assert.equal(bearer.status, 403);
});

test('a canary session cannot issue a handoff, delete an account or log out', async () => {
  const env = newEnv();
  const token = await session(env);
  const target = encodeURIComponent('https://console.freegamestore.online');
  assert.equal((await viaWorker(env, `/handoff/issue?target=${target}`, { method: 'POST', token })).status, 403);
  assert.equal((await viaWorker(env, '/account', { method: 'DELETE', token })).status, 403);
  assert.equal((await viaWorker(env, '/logout', { method: 'POST', token, cookie: true })).status, 403);
});

test('a canary-looking token is refused even where its signature is never checked', async () => {
  const env = newEnv();
  const forged = await jwtSign({ typ: 'fgs_canary', sub: CANARY_SUB, canary: true, exp: 4e9 }, 'not-the-secret');
  assert.equal((await viaWorker(env, '/me', { token: forged })).status, 403);
});

test('an ordinary session still works on /me', async () => {
  const env = newEnv(['github:7']);
  const user = await jwtSign({ sub: 'github:7', login: 'someone', exp: Math.floor(Date.now() / 1000) + 600 }, SECRET);
  assert.equal((await viaWorker(env, '/me', { token: user })).status, 200);
});
