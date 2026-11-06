import assert from 'node:assert/strict';
import test from 'node:test';
import { GAME_DEPLOY_WORKFLOW } from '../packages/compliance/dist/index.js';
import { COMMIT_MESSAGE, drift, TEMPLATES } from './sync-game-templates.mjs';

const ok = {
  '.github/workflows/deploy.yml': GAME_DEPLOY_WORKFLOW,
  '.github/workflows/ci.yml': 'name: CI\n',
};

test('a template that matches the generator has no drift', () => {
  assert.deepEqual(drift(ok, GAME_DEPLOY_WORKFLOW), []);
});

test('an inline deploy, a revived cron and an R2 secret are each reported', () => {
  const problems = drift(
    {
      ...ok,
      // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub Actions template syntax in string literal
      '.github/workflows/deploy.yml': 'run: aws s3 sync\nenv: ${{ secrets.R2_ACCESS_KEY_ID }}\n',
      '.github/workflows/update-deps.yml': 'run: pnpm up -r --latest\n',
    },
    GAME_DEPLOY_WORKFLOW,
  );
  assert.deepEqual(problems, [
    'deploy.yml differs from GAME_DEPLOY_WORKFLOW',
    'update-deps.yml still exists',
    '.github/workflows/deploy.yml reads R2 secrets',
  ]);
});

test('a missing deploy.yml is drift; a comment naming a secret is not', () => {
  assert.deepEqual(
    drift({ '.github/workflows/ci.yml': '# secrets.R2_X was removed\n' }, GAME_DEPLOY_WORKFLOW),
    ['deploy.yml is missing'],
  );
});

test('covers the ten engine templates and the commit refs the issues', () => {
  assert.equal(new Set(TEMPLATES).size, 10);
  assert.match(COMMIT_MESSAGE, /#494/);
});
