import { describe, expect, it } from 'vitest';
import { GAME_CI_WORKFLOW, GAME_DEPLOY_WORKFLOW } from './game-deploy-workflow.js';

describe('GAME_DEPLOY_WORKFLOW', () => {
  it('calls the keyless ci-workflows pipeline pinned to a commit (#488)', () => {
    expect(GAME_DEPLOY_WORKFLOW).toContain(`uses: ${GAME_CI_WORKFLOW}\n`);
    expect(GAME_CI_WORKFLOW).toMatch(
      /^freegamestore-online\/ci-workflows\/\.github\/workflows\/game-deploy\.yml@[0-9a-f]{40}$/,
    );
    expect(GAME_DEPLOY_WORKFLOW).not.toContain('freegamestore-online/freegamestore/');
  });

  it('passes no secret at all, so no R2 key reaches a game repo (#437, #488)', () => {
    expect(GAME_DEPLOY_WORKFLOW).not.toMatch(/secrets/);
    expect(GAME_DEPLOY_WORKFLOW).not.toContain('R2_');
  });

  it('grants exactly what the keyless deploy needs', () => {
    expect(GAME_DEPLOY_WORKFLOW).toMatch(
      / {4}permissions:\n {6}contents: read\n {6}id-token: write\n$/,
    );
  });

  it('deploys on push to main and on dispatch', () => {
    expect(GAME_DEPLOY_WORKFLOW).toMatch(/push:\n {4}branches: \[main\]/);
    expect(GAME_DEPLOY_WORKFLOW).toContain('  workflow_dispatch:\n');
  });

  it('skips a template repo, which is not a game (#494)', () => {
    expect(GAME_DEPLOY_WORKFLOW).toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub Actions template syntax in string literal
      'if: ${{ !github.event.repository.is_template }}\n    uses:',
    );
  });

  it('leaves GitHub expressions for Actions to expand', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub Actions template syntax in string literal
    expect(GAME_DEPLOY_WORKFLOW).toContain('group: ${{ github.workflow }}-${{ github.ref }}');
  });
});
