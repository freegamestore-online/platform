import assert from 'node:assert/strict';
import test from 'node:test';
import { exchangeCanarySession } from './canary-session.mjs';

const ENV = {
  ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.actions.example/req?api-version=2.0',
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-token',
};

function run(env, handlers) {
  const log = [];
  const calls = [];
  const doFetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return handlers[String(url).startsWith('https://auth.') ? 'exchange' : 'mint'](url, init);
  };
  return { log, calls, done: exchangeCanarySession({ env, doFetch, log: (l) => log.push(l) }) };
}

test('mints with the canary audience, exchanges it, and masks both tokens before use', async () => {
  const r = run(ENV, {
    mint: () => Response.json({ value: 'oidc-jwt' }),
    exchange: () => Response.json({ token: 'session-jwt' }),
  });
  assert.equal(await r.done, 'session-jwt');
  const mint = new URL(r.calls[0].url);
  assert.equal(mint.searchParams.get('audience'), 'freegamestore-canary');
  assert.equal(mint.searchParams.get('api-version'), '2.0');
  assert.equal(r.calls[0].init.headers.Authorization, 'Bearer request-token');
  assert.equal(r.calls[1].url, 'https://auth.freegamestore.online/canary/session');
  assert.equal(r.calls[1].init.headers.Authorization, 'Bearer oidc-jwt');
  assert.deepEqual(r.log, ['::add-mask::oidc-jwt', '::add-mask::session-jwt']);
});

test('fails clearly outside a job with id-token: write', async () => {
  await assert.rejects(run({}, {}).done, /id-token: write/);
});

test('reports the exchange refusal by status and reason code only', async () => {
  const r = run(ENV, {
    mint: () => Response.json({ value: 'oidc-jwt' }),
    exchange: () =>
      Response.json({ error: 'forbidden', reason: 'wrong_workflow' }, { status: 403 }),
  });
  await assert.rejects(
    r.done,
    (e) => /HTTP 403.*wrong_workflow/.test(e.message) && !e.message.includes('oidc-jwt'),
  );
});

test('fails when GitHub will not mint a token', async () => {
  await assert.rejects(
    run(ENV, { mint: () => new Response('no', { status: 403 }), exchange: () => assert.fail() })
      .done,
    /would not mint/,
  );
});
