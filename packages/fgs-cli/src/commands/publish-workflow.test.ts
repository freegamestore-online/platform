import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GAME_DEPLOY_WORKFLOW } from '@freegamestore/compliance';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureDeployWorkflow } from './publish-workflow.js';

// #111: `fgs publish` writes the same deploy.yml the agent ships. The tracker
// gate that used to be grepped inline here now runs as the real checkNoTracking
// inside the ci-workflows pipeline (`fgs check`), and is tested there.
describe('ensureDeployWorkflow', () => {
  const cwd = process.cwd();
  let dir: string;
  const target = () => join(dir, '.github', 'workflows', 'deploy.yml');

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fgs-deploy-wf-'));
    process.chdir(dir);
  });
  afterEach(() => {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes the shared game deploy workflow when the repo has none', async () => {
    expect(await ensureDeployWorkflow()).toBe('added');
    expect(readFileSync(target(), 'utf8')).toBe(GAME_DEPLOY_WORKFLOW);
  });

  it('reports a supported file as unchanged and does not rewrite it', async () => {
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
    writeFileSync(target(), GAME_DEPLOY_WORKFLOW);
    expect(await ensureDeployWorkflow()).toBe('unchanged');
    expect(readFileSync(target(), 'utf8')).toBe(GAME_DEPLOY_WORKFLOW);
  });

  it.each([
    ['legacy inline R2', 'jobs:\n  d:\n    steps:\n      - run: aws s3 sync dist s3://b\n'],
    [
      'game-ci.yml + secrets: inherit',
      'jobs:\n  ci:\n    uses: x/ci-workflows/.github/workflows/game-ci.yml@main\n    secrets: inherit\n',
    ],
  ])('replaces a %s file with the supported workflow (#523)', async (_n, legacy) => {
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
    writeFileSync(target(), legacy);
    expect(await ensureDeployWorkflow()).toBe('replaced');
    expect(readFileSync(target(), 'utf8')).toBe(GAME_DEPLOY_WORKFLOW);
  });
});
