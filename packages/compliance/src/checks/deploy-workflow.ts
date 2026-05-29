import type { FileSource } from '../lib/file-source.js';
import type { CheckResult } from '../types.js';

const DEPLOY_YML = '.github/workflows/deploy.yml';

/**
 * Games auto-deploy to R2 via GitHub Actions on push to main. Without
 * `.github/workflows/deploy.yml`, pushes won't trigger a deploy and
 * the game stays stale on the storefront.
 */
export async function checkDeployWorkflow(source: FileSource): Promise<CheckResult> {
  const content = await source.read(DEPLOY_YML);
  if (content !== null) {
    return {
      name: 'Deploy workflow',
      status: 'pass',
      detail: `${DEPLOY_YML} exists`,
    };
  }
  return {
    name: 'Deploy workflow',
    status: 'warn',
    detail: `${DEPLOY_YML} not found`,
    suggestions: [
      'Add a deploy workflow so pushes to main auto-deploy to the storefront.',
      'Run `fgs init` to scaffold a game with the standard deploy workflow, or copy one from an existing game repo.',
    ],
  };
}
