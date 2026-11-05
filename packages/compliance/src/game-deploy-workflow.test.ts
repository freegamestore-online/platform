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

  it('forwards exactly the R2 secrets game-ci reads, never `inherit` (#437)', () => {
    expect(GAME_DEPLOY_WORKFLOW).not.toContain('secrets: inherit');
    const block = GAME_DEPLOY_WORKFLOW.match(/^ {4}secrets:\n((?: {6}.*\n)+)/m);
    expect(block).not.toBeNull();
    const forwarded = block?.[1]
      .trim()
      .split('\n')
      .map((line) => line.trim())
      .sort();
    expect(forwarded).toEqual(
      [
        // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub Actions template syntax in string literal
        'R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub Actions template syntax in string literal
        'R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub Actions template syntax in string literal
        'R2_ACCOUNT_ID: ${{ secrets.R2_ACCOUNT_ID }}',
      ].sort(),
    );
  });

  it('deploys on push to main', () => {
    expect(GAME_DEPLOY_WORKFLOW).toMatch(/push:\n {4}branches: \[main\]/);
  });

  it('leaves GitHub expressions for Actions to expand', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub Actions template syntax in string literal
    expect(GAME_DEPLOY_WORKFLOW).toContain('group: ${{ github.workflow }}-${{ github.ref }}');
  });
});
