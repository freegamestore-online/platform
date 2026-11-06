/** The reusable pipeline every game's deploy.yml calls: build, `fgs check`
 *  compliance gate, version.json stamp, smoke test, then the keyless upload on
 *  push to main (#488, #438). Pinned by commit: a moved branch must not change
 *  what deploys every game. Bump it deliberately with the fleet tool. */
export const GAME_CI_WORKFLOW =
  'freegamestore-online/ci-workflows/.github/workflows/game-deploy.yml@f726c09f22ad6e713f9a39054bebc16b4370775a';

/**
 * The `.github/workflows/deploy.yml` a game repo gets when `fgs publish` or the
 * VibeCode agent has to supply one (#111), and the one the fleet tool writes
 * (scripts/fleet-deploy-workflow.mjs). The single source for all three. The
 * pipeline itself lives in ci-workflows, so this is only the thin caller.
 *
 * No secret is passed: the deploy job authenticates with a GitHub OIDC token,
 * which is why the caller grants `id-token: write` (a called workflow can't
 * exceed its caller's permissions). Node-free: re-exported from `./worker`.
 */
export const GAME_DEPLOY_WORKFLOW = `name: CI / Deploy

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:

# Most-recent push/PR for a ref wins; older runs are cancelled so a deploy
# never wins a race against a fresh build of the same branch.
concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  ci-and-deploy:
    uses: ${GAME_CI_WORKFLOW}
    # The deploy job uploads with a GitHub OIDC token; no R2 secret (#488).
    permissions:
      contents: read
      id-token: write
`;
