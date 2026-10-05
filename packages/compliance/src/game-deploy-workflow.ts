/** The reusable pipeline every game's deploy.yml calls (#123): build, `fgs check`
 *  compliance gate, version.json stamp, smoke test, then R2 sync on push to main. */
export const GAME_CI_WORKFLOW =
  'freegamestore-online/ci-workflows/.github/workflows/game-ci.yml@main';

/**
 * The `.github/workflows/deploy.yml` a game repo gets when `fgs publish` or the
 * VibeCode agent has to supply one (#111). The single source for both — they
 * used to carry their own inline copies, which drifted. The pipeline itself
 * lives in ci-workflows, so this is only the thin caller the fleet already uses.
 * Node-free: re-exported from `./worker` for the agent.
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
    permissions:
      contents: read
      deployments: write
    secrets: inherit
`;
