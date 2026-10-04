import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

for (const setting of ['default', 'relative', 'absolute']) {
  test(`opt-in installer respects ${setting} hooks path and propagates lint failures`, () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'fgs-hooks-')));
    try {
      mkdirSync(join(root, 'scripts'));
      copyFileSync(
        new URL('./install-hooks.sh', import.meta.url),
        join(root, 'scripts/install-hooks.sh'),
      );
      const bin = join(root, 'bin');
      mkdirSync(bin);
      const pnpm = join(bin, 'pnpm');
      writeFileSync(
        pnpm,
        '#!/usr/bin/env bash\nprintf "%s:%s" "$PWD" "$*" > "$GUARD_LOG"\nexit "$GUARD_STATUS"\n',
      );
      chmodSync(pnpm, 0o755);
      const env = {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null',
        GUARD_LOG: join(root, 'guard.log'),
        GUARD_STATUS: '0',
      };
      const run = (command, args, overrides = {}) =>
        spawnSync(command, args, { cwd: root, env: { ...env, ...overrides }, encoding: 'utf8' });
      assert.equal(run('git', ['init']).status, 0);
      const hooksPath = setting === 'absolute' ? join(root, 'custom hooks') : '.githooks';
      if (setting !== 'default')
        assert.equal(run('git', ['config', 'core.hooksPath', hooksPath]).status, 0);
      const hooksDir = join(
        setting === 'default'
          ? join(root, '.git/hooks')
          : setting === 'absolute'
            ? hooksPath
            : join(root, hooksPath),
      );
      const preCommitHook = join(hooksDir, 'pre-commit');
      const prePushHook = join(hooksDir, 'pre-push');

      // Verify hooks don't exist before install
      assert.equal(existsSync(preCommitHook), false);
      assert.equal(existsSync(prePushHook), false);

      // Install hooks
      const install = run('bash', ['scripts/install-hooks.sh']);
      assert.equal(install.status, 0, install.stderr);

      // Test pre-commit hook runs lint successfully
      assert.equal(run(preCommitHook, []).status, 0);
      let guardLog = readFileSync(env.GUARD_LOG, 'utf8');
      assert.ok(guardLog.endsWith(':lint'));
      assert.equal(realpathSync(guardLog.slice(0, -5)), realpathSync(root));

      // Test pre-commit hook fails when lint fails
      assert.equal(run(preCommitHook, [], { GUARD_STATUS: '1' }).status, 1);

      // Test pre-push hook runs lint successfully
      assert.equal(run(prePushHook, []).status, 0);
      guardLog = readFileSync(env.GUARD_LOG, 'utf8');
      assert.ok(guardLog.endsWith(':lint'));

      // Test pre-push hook fails when lint fails
      assert.equal(run(prePushHook, [], { GUARD_STATUS: '1' }).status, 1);

      // Reinstalling should work
      assert.equal(run('bash', ['scripts/install-hooks.sh']).status, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
