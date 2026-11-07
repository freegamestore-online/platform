import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { GAME_DEPLOY_WORKFLOW } from '../packages/compliance/dist/index.js';
import {
  bumpGamesSdk,
  COMMIT_MESSAGE,
  CSS_COMMIT_MESSAGE,
  classify,
  ensureSdkCss,
  GAMES_SDK,
  needsSdkCss,
} from './fleet-deploy-workflow.mjs';

const generated = GAME_DEPLOY_WORKFLOW;

/** The inline single-job-with-gate workflow 112 games still run. */
const INLINE = `name: Deploy to R2

on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: deploy-\${{ github.repository }}
  cancel-in-progress: true

jobs:
  compliance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: No tracking SDKs in source
        run: grep -r mixpanel web/src && exit 1 || true
  deploy:
    needs: compliance
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - name: Install
        run: pnpm install --frozen-lockfile
      - name: Build
        run: pnpm build
      - name: Upload to R2
        env:
          AWS_ACCESS_KEY_ID: \${{ secrets.R2_ACCESS_KEY_ID }}
        run: |
          aws s3 sync ./web/dist "s3://fgs-games/games/\${GITHUB_REPOSITORY##*/}/" --delete
`;

const GAME_CI_CALLER = `name: CI / Deploy
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
jobs:
  ci-and-deploy:
    uses: freegamestore-online/ci-workflows/.github/workflows/game-ci.yml@main
    with:
      cf_project: freechessapp
    permissions:
      contents: read
      deployments: write
    secrets: inherit
`;

test('an up-to-date workflow is skipped (idempotent)', () => {
  assert.deepEqual(classify(generated, generated), { variant: 'current', review: [] });
});

test('the inline and game-ci shapes are rewritten without review', () => {
  assert.deepEqual(classify(INLINE, generated), { variant: 'inline', review: [] });
  assert.deepEqual(classify(GAME_CI_CALLER, generated), { variant: 'game-ci-caller', review: [] });
  const stamped = INLINE.replace(
    '      - name: Upload to R2',
    '      - name: Stamp version.json\n        run: echo\n      - name: Upload to R2',
  );
  assert.equal(classify(stamped, generated).variant, 'inline-versionjson');
});

test('an older keyless caller (a game-deploy.yml pin bump) is rewritten', () => {
  const older = generated.replace(/@[0-9a-f]{40}/, `@${'0'.repeat(40)}`);
  assert.deepEqual(classify(older, generated), { variant: 'keyless-outdated', review: [] });
});

for (const [name, text, reason] of [
  [
    'another secret',
    INLINE.replace('secrets.R2_ACCESS_KEY_ID', 'secrets.SENTRY_DSN'),
    /secrets SENTRY_DSN/,
  ],
  [
    'a repo variable',
    INLINE.replace('run: pnpm build', 'run: VITE_X=${{ vars.X }} pnpm build'),
    /repo variables/,
  ],
  [
    'an extra step',
    INLINE.replace(
      '      - name: Build',
      '      - name: Bake levels\n        run: node bake.js\n      - name: Build',
    ),
    /step "Bake levels"/,
  ],
  ['another sync source', INLINE.replace('sync ./web/dist', 'sync ./dist'), /syncs \.\/dist/],
  [
    'a schedule',
    INLINE.replace(
      '  workflow_dispatch:',
      '  workflow_dispatch:\n  schedule:\n    - cron: "0 0 * * *"',
    ),
    /triggers/,
  ],
  [
    'wrangler',
    INLINE.replace('aws s3 sync', 'npx wrangler r2 object put x; aws s3 sync'),
    /wrangler/,
  ],
  [
    'reusable inputs beyond cf_project',
    GAME_CI_CALLER.replace('cf_project: freechessapp', 'node_version: "20"'),
    /inputs/,
  ],
]) {
  test(`sends a workflow with ${name} to hand review`, () => {
    assert.match(classify(text, generated).review.join('; '), reason);
  });
}

test(`moves @freegamestore/games below ${GAMES_SDK} to ^${GAMES_SDK}, and leaves newer ones`, () => {
  const pkg = (range) =>
    JSON.stringify({ dependencies: { '@freegamestore/games': range, react: '^19' } });
  assert.equal(
    JSON.parse(bumpGamesSdk(pkg('^0.19.0'))).dependencies['@freegamestore/games'],
    `^${GAMES_SDK}`,
  );
  assert.equal(JSON.parse(bumpGamesSdk(pkg('^0.14.0'))).dependencies.react, '^19');
  assert.equal(
    JSON.parse(bumpGamesSdk(pkg('^0.20.1'))).dependencies['@freegamestore/games'],
    `^${GAMES_SDK}`,
  );
  assert.equal(bumpGamesSdk(pkg(`^${GAMES_SDK}`)), null);
  assert.equal(bumpGamesSdk(pkg('^0.21.0')), null);
  assert.equal(bumpGamesSdk(pkg('^1.0.0')), null);
  assert.equal(bumpGamesSdk(JSON.stringify({ dependencies: { react: '^19' } })), null);
});

test('the generated caller holds no secret and pins game-deploy by commit', () => {
  assert.doesNotMatch(generated, /secrets/);
  assert.match(generated, /game-deploy\.yml@[0-9a-f]{40}\n/);
  assert.match(generated, /id-token: write/);
});

test('commits with the issue references and attribution', () => {
  assert.match(COMMIT_MESSAGE, /^ci: /);
  assert.match(
    COMMIT_MESSAGE,
    /Refs freegamestore-online\/platform#488, freegamestore-online\/platform#438/,
  );
  assert.equal(
    COMMIT_MESSAGE.trim().split('\n').at(-1),
    'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>',
  );
});

test('the drifted copies of the workflow are gone (one generator, #482)', () => {
  for (const path of [
    '../sites/freegamestore/scripts/migrate-game-ci.sh',
    '../sites/freegamestore/deploy-workflow.yml',
  ])
    assert.throws(() => readFileSync(new URL(path, import.meta.url)));
});

const OLD_CSS = `@import "tailwindcss";

/* Fonts loaded via <link> */

:root {
  --paper: #ffffff;
}
`;

test('index.css gets the SDK theme import, the @source and the tokens (#519)', () => {
  const out = ensureSdkCss(OLD_CSS);
  assert.match(out, /^@import "tailwindcss";\n@import "@freegamestore\/games\/theme\.css";/);
  assert.match(out, /@source "\.\.\/node_modules\/@freegamestore\/games\/dist";/);
  for (const name of [
    'paper',
    'panel',
    'ink',
    'muted',
    'line',
    'accent',
    'success',
    'warning',
    'danger',
  ])
    assert.match(out, new RegExp(`--color-${name}: var\\(--${name}`));
  assert.match(out, /--font-display: "Fraunces", serif;/);
  assert.ok(
    out.endsWith(OLD_CSS.slice(OLD_CSS.indexOf('\n/* Fonts'))),
    'rest of the file is untouched',
  );
});

test('ensureSdkCss is idempotent and only adds what is missing', () => {
  const once = ensureSdkCss(OLD_CSS);
  assert.equal(ensureSdkCss(once), null);
  const partial = `@import "tailwindcss";\n@source "../node_modules/@freegamestore/games/dist";\n@theme inline {\n  --color-paper: var(--paper);\n}\n`;
  const out = ensureSdkCss(partial);
  assert.equal(out.match(/@source/g).length, 1);
  assert.equal(out.match(/--color-paper/g).length, 1);
  assert.match(out, /theme\.css/);
  assert.match(out, /--color-ink/);
});

test('ensureSdkCss leaves a file that is not a Tailwind v4 entry alone', () => {
  assert.equal(ensureSdkCss('body { margin: 0 }\n'), null);
});

test('the SDK CSS is only needed from 0.20 on', () => {
  assert.equal(needsSdkCss('^0.14.0'), false);
  assert.equal(needsSdkCss('^0.19.1'), false);
  assert.equal(needsSdkCss('^0.20.2'), true);
  assert.equal(needsSdkCss('^1.0.0'), true);
  assert.equal(needsSdkCss(undefined), false);
});

test('the css-only commit refs the issues and carries attribution', () => {
  assert.match(CSS_COMMIT_MESSAGE, /Refs freegamestore-online\/platform#519/);
  assert.equal(
    CSS_COMMIT_MESSAGE.trim().split('\n').at(-1),
    'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>',
  );
});
