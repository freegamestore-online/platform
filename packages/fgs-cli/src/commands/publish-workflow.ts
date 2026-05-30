import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const DEPLOY_YML = `name: Deploy to R2

on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: deploy-\${{ github.repository }}
  cancel-in-progress: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Install
        run: pnpm install --frozen-lockfile

      - name: Build
        run: pnpm build

      - name: Verify build output
        run: |
          test -d ./web/dist || { echo "::error::No build output at web/dist"; exit 1; }
          test -n "$(ls -A ./web/dist)" || { echo "::error::web/dist is empty"; exit 1; }

      - name: Upload to R2
        env:
          AWS_ACCESS_KEY_ID: \${{ secrets.R2_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: \${{ secrets.R2_SECRET_ACCESS_KEY }}
          AWS_DEFAULT_REGION: auto
          R2_ACCOUNT_ID: \${{ secrets.R2_ACCOUNT_ID }}
        run: |
          aws s3 sync ./web/dist "s3://fas-apps/games/$\{GITHUB_REPOSITORY##*/}/" \\
            --endpoint-url "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com" \\
            --delete \\
            --no-progress
          echo "Deployed games/$\{GITHUB_REPOSITORY##*/} from $\{GITHUB_SHA::7}"
`;

export async function ensureDeployWorkflow(): Promise<boolean> {
  const target = join(process.cwd(), '.github', 'workflows', 'deploy.yml');
  try {
    await access(target);
    return false;
  } catch {
    await mkdir(join(process.cwd(), '.github', 'workflows'), { recursive: true });
    await writeFile(target, DEPLOY_YML);
    return true;
  }
}
