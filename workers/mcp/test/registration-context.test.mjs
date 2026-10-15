// #72 — init() built the tool context from a SNAPSHOT of the props. Agents
// loads Durable Object props asynchronously and setAuth() can replace them
// after init(); the tools kept the init-time `{}` for the life of the instance,
// so every write tool said "Not authenticated" and audits were keyed `anon`.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Tool modules import siblings as './x.js'; Node's type stripping loads .ts but
// won't map the .js specifier. Retry as .ts.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (/^\.\.?\//.test(specifier) && specifier.endsWith('.js')) {
        return nextResolve(specifier.replace(/\.js$/, '.ts'), context);
      }
      throw err;
    }
  },
});

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { createRegistrationContext } = await import(resolve(root, 'src/tools/registration.ts'));
const { registerGameFilesTools } = await import(resolve(root, 'src/tools/game-files.ts'));

const env = { GITHUB_ORG: 'freegamestore-online', STORE_REPO: 'platform', GITHUB_TOKEN: 't' };

/** A stand-in agent whose props, like the real one's, can change after init. */
function agent() {
  const a = { props: undefined };
  const handlers = {};
  const ctx = createRegistrationContext({
    server: {},
    env,
    ownerSlug: env.GITHUB_ORG,
    safeTool: (name, _d, _s, handler) => {
      handlers[name] = handler;
    },
    ownsGame: async () => false,
    sessionPrefix: (u) => `mcp-${u ?? 'anon'}-`,
    session: () => a.props ?? {},
    safety: () => ({ env, subject: (a.props ?? {}).userId }),
  });
  return { a, ctx, handlers };
}

test('the context reflects props that arrive after it was built', () => {
  const { a, ctx } = agent();
  assert.deepEqual(ctx.session, {});
  assert.equal(ctx.login, undefined);
  assert.equal(ctx.safetyCtx.subject, undefined);

  a.props = { userId: 'grace', token: 'session-token' }; // setAuth() after init()
  assert.equal(ctx.session.userId, 'grace');
  assert.equal(ctx.login, 'grace');
  assert.equal(ctx.accessToken, 'session-token');
  assert.equal(ctx.safetyCtx.subject, 'grace');
});

test('a write tool registered before auth arrives still sees the session afterwards', async () => {
  const { a, ctx, handlers } = agent();
  registerGameFilesTools(ctx);
  const call = () =>
    handlers.update_files({ game_id: 'space-rescue', files: [{ path: 'a.txt', content: 'x' }] });

  assert.match((await call()).content[0].text, /Not authenticated/);
  a.props = { userId: 'grace', token: 'session-token' };
  const after = (await call()).content[0].text;
  assert.doesNotMatch(after, /Not authenticated/);
  assert.match(after, /don't own "space-rescue"/); // past the auth gate, at the ownership gate
});

test('init() builds the tool context from live props, not a snapshot', async () => {
  const src = await readFile(resolve(root, 'src/index.ts'), 'utf8');
  const init = src.slice(src.indexOf('async init()'));
  assert.match(init, /createRegistrationContext\(/);
  assert.doesNotMatch(init, /session:\s*this\.session\s*,/);
  assert.doesNotMatch(init, /login:\s*this\.session\.userId/);
});
