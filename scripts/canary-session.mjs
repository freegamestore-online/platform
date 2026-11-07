#!/usr/bin/env node
// Keyless session for the create canary (#531).
//
// Inside a GitHub Actions job with `permissions: id-token: write`, asks GitHub
// for an OIDC token with audience `freegamestore-canary` and trades it at the
// auth worker (POST /canary/session) for a 15-minute fgs_token that names no
// person and may only create and delete one `e2e-create-*-test` game. Nothing is
// stored anywhere. The auth worker accepts the token only from
// create-canary.yml on main, run by workflow_dispatch or schedule.
//
//   node scripts/canary-session.mjs     # in a workflow step: exports FGS_SESSION_TOKEN
//
// Both tokens are masked in the log before they are used, and the session goes
// to later steps through $GITHUB_ENV, never through stdout.

import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const CANARY_AUDIENCE = 'freegamestore-canary';
const EXCHANGE_URL = 'https://auth.freegamestore.online/canary/session';

/** Mint this job's OIDC token and trade it for a canary session. Throws with the
 *  HTTP status and the exchange's reason code only. `env` and `doFetch` are
 *  injectable for tests. */
export async function exchangeCanarySession({
  env = process.env,
  doFetch = fetch,
  log = (line) => console.log(line),
} = {}) {
  const requestUrl = env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!requestUrl || !requestToken)
    throw new Error('no OIDC token available: the job needs `permissions: id-token: write`');

  const url = new URL(requestUrl);
  url.searchParams.set('audience', CANARY_AUDIENCE);
  const minted = await doFetch(url, { headers: { Authorization: `Bearer ${requestToken}` } });
  if (!minted.ok) throw new Error(`GitHub would not mint an OIDC token (HTTP ${minted.status})`);
  const oidc = (await minted.json()).value;
  if (!oidc) throw new Error('GitHub returned no OIDC token');
  log(`::add-mask::${oidc}`);

  const res = await doFetch(EXCHANGE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${oidc}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(
      `canary session exchange refused (HTTP ${res.status}): ${body.reason ?? 'no reason'}`,
    );
  if (!body.token) throw new Error('canary session exchange returned no token');
  log(`::add-mask::${body.token}`);
  return body.token;
}

async function main() {
  const token = await exchangeCanarySession();
  if (!process.env.GITHUB_ENV)
    throw new Error('GITHUB_ENV is not set: run this in a workflow step');
  appendFileSync(process.env.GITHUB_ENV, `FGS_SESSION_TOKEN=${token}\n`);
  console.log('canary session exchanged (15 minutes, create/delete e2e-create-*-test only)');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => {
    console.error(`::error::${e.message}`);
    process.exit(1);
  });
}
