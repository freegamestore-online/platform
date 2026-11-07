import { GAME_CI_WORKFLOW } from '../game-deploy-workflow.js';
import type { FileSource } from '../lib/file-source.js';
import type { CheckResult } from '../types.js';

const DEPLOY_YML = '.github/workflows/deploy.yml';
const NAME = 'Deploy workflow';

/** What marks a workflow as a legacy deploy: a secrets block (incl. `inherit`),
 *  the shared R2 key, an inline S3 upload, or the old secret-taking pipeline. */
const LEGACY_MARKERS: Array<[RegExp, string]> = [
  [/^\s*secrets\s*:/m, 'a `secrets:` block'],
  [/R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY/, 'the shared R2 key'],
  [/\baws\s+s3\b/, 'an inline `aws s3` upload'],
  [/game-ci\.yml/, 'the legacy `game-ci.yml` pipeline'],
];

const FIX = [
  'Run `fgs publish` (it rewrites deploy.yml to the supported keyless caller), or the fleet tool: `node scripts/fleet-deploy-workflow.mjs`.',
];

const CALLER =
  /^\s*uses:\s*freegamestore-online\/ci-workflows\/\.github\/workflows\/game-deploy\.yml@[0-9a-f]{40}\s*$/m;
const OIDC = /^\s*id-token:\s*write\s*$/m;

/**
 * Games auto-deploy via GitHub Actions on push to main, through the keyless
 * `game-deploy.yml` caller (#488). The check fails on any other deploy.yml:
 * a legacy workflow holds or inherits the shared R2 key (#522). A missing file
 * only warns: nothing deploys, but nothing holds a key either.
 *
 * There is no warn-first switch: every registered game was migrated by the
 * fleet tool (#488), so failing here breaks none of them.
 */
export async function checkDeployWorkflow(source: FileSource): Promise<CheckResult> {
  const content = await source.read(DEPLOY_YML);
  if (content === null) {
    return {
      name: NAME,
      status: 'warn',
      detail: `${DEPLOY_YML} not found`,
      suggestions: [
        'Add a deploy workflow so pushes to main auto-deploy to the storefront.',
        'Run `fgs init` to scaffold a game with the standard deploy workflow, or copy one from an existing game repo.',
      ],
    };
  }

  // Comments may legitimately mention secrets ("no R2 secret"); only code counts.
  const code = content
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');

  const legacy = LEGACY_MARKERS.filter(([re]) => re.test(code)).map(([, what]) => what);
  if (legacy.length > 0) {
    return {
      name: NAME,
      status: 'fail',
      detail: `${DEPLOY_YML} is a legacy deploy workflow (${legacy.join(', ')})`,
      suggestions: FIX,
    };
  }

  if (!CALLER.test(code) || !OIDC.test(code)) {
    return {
      name: NAME,
      status: 'fail',
      detail: `${DEPLOY_YML} must call ${GAME_CI_WORKFLOW.split('@')[0]}@<sha> and declare \`permissions: id-token: write\``,
      suggestions: FIX,
    };
  }

  return { name: NAME, status: 'pass', detail: `${DEPLOY_YML} is the supported keyless caller` };
}
