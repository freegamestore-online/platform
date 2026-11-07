import { describe, expect, it } from 'vitest';
import { GAME_DEPLOY_WORKFLOW } from '../game-deploy-workflow.js';
import type { FileSource } from '../lib/file-source.js';
import { checkDeployWorkflow } from './deploy-workflow.js';

const src = (content: string | null): FileSource => ({
  async *list() {},
  read: async () => content,
});

const INLINE = `name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm install
      - run: aws s3 sync dist s3://b
        env:
          AWS_ACCESS_KEY_ID: \${{ secrets.R2_ACCESS_KEY_ID }}
`;

const GAME_CI = `name: CI
on:
  push:
    branches: [main]
jobs:
  ci:
    uses: freegamestore-online/ci-workflows/.github/workflows/game-ci.yml@main
    secrets: inherit
`;

describe('checkDeployWorkflow (#522)', () => {
  it('passes the supported keyless caller', async () => {
    expect((await checkDeployWorkflow(src(GAME_DEPLOY_WORKFLOW))).status).toBe('pass');
  });

  it('fails the legacy inline R2 workflow', async () => {
    const r = await checkDeployWorkflow(src(INLINE));
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('R2 key');
    expect(r.suggestions?.[0]).toContain('fgs publish');
  });

  it('fails game-ci.yml with secrets: inherit', async () => {
    const r = await checkDeployWorkflow(src(GAME_CI));
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('secrets:');
    expect(r.detail).toContain('game-ci.yml');
  });

  it('fails a game-deploy caller that passes secrets', async () => {
    const r = await checkDeployWorkflow(src(`${GAME_DEPLOY_WORKFLOW}    secrets: inherit\n`));
    expect(r.status).toBe('fail');
  });

  it('fails a caller without id-token: write', async () => {
    const r = await checkDeployWorkflow(
      src(GAME_DEPLOY_WORKFLOW.replace('id-token: write', 'id-token: none')),
    );
    expect(r.status).toBe('fail');
  });

  it('fails a caller pinned to a branch, not a commit', async () => {
    const r = await checkDeployWorkflow(
      src(GAME_DEPLOY_WORKFLOW.replace(/@[0-9a-f]{40}/, '@main')),
    );
    expect(r.status).toBe('fail');
  });

  it('ignores comments that mention secrets', async () => {
    const r = await checkDeployWorkflow(
      src(`# secrets: none, R2_ACCESS_KEY_ID unused\n${GAME_DEPLOY_WORKFLOW}`),
    );
    expect(r.status).toBe('pass');
  });

  it('warns when the file is missing (unchanged)', async () => {
    expect((await checkDeployWorkflow(src(null))).status).toBe('warn');
  });
});
