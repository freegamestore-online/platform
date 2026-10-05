import { describe, expect, it } from 'vitest';
import { GAME_CI_WORKFLOW, GAME_DEPLOY_WORKFLOW } from './game-deploy-workflow.js';

describe('GAME_DEPLOY_WORKFLOW', () => {
  it('calls the ci-workflows pipeline, not the retired storefront copy (#123)', () => {
    expect(GAME_DEPLOY_WORKFLOW).toContain(`uses: ${GAME_CI_WORKFLOW}\n`);
    expect(GAME_CI_WORKFLOW).toBe(
      'freegamestore-online/ci-workflows/.github/workflows/game-ci.yml@main',
    );
    expect(GAME_DEPLOY_WORKFLOW).not.toContain('freegamestore-online/freegamestore/');
  });

  it('passes the R2 org secrets through and deploys on push to main', () => {
    expect(GAME_DEPLOY_WORKFLOW).toContain('secrets: inherit');
    expect(GAME_DEPLOY_WORKFLOW).toMatch(/push:\n {4}branches: \[main\]/);
  });

  it('leaves GitHub expressions for Actions to expand', () => {
    expect(GAME_DEPLOY_WORKFLOW).toContain('group: ${{ github.workflow }}-${{ github.ref }}');
  });
});
