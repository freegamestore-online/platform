import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Tracker SDKs the game deploy workflow refuses in web/src (#93). Mirrors the
 *  SDK-context patterns of @freegamestore/compliance's no-tracking check:
 *  distinctive SDK names need word boundaries, and ordinary words — `segment`
 *  (snake/line segments), `amplitude` (audio, physics), `gtag` — only count in
 *  SDK context (scoped package, host, call site). The old bare-word grep failed
 *  the compliance job for any snake or audio game, so it never deployed.
 *  POSIX bracket classes instead of \b so GNU (CI) and BSD grep agree. Used
 *  inside a double-quoted bash string: `\"` is a literal quote. */
export const TRACKER_GREP_ERE = String.raw`google-analytics|googletagmanager\.com|gtag[[:space:]]*\([[:space:]]*[\"']|window\.gtag([^[:alnum:]_]|$)|gtag\.js|@amplitude/|amplitude\.com|(^|[^[:alnum:]_])amplitude[[:space:]]*\.[[:space:]]*(init|track|getInstance|setUserId|logEvent)([^[:alnum:]_]|$)|require\([\"']amplitude|from[[:space:]]+[\"']amplitude|(^|[^[:alnum:]_])mixpanel([^[:alnum:]_]|$)|@segment/|segment\.io|segment\.com/analytics|cdn\.segment\.com|window\.analytics[[:space:]]*\.[[:space:]]*(track|identify|page|group)([^[:alnum:]_]|$)|(^|[^[:alnum:]_])AnalyticsBrowser\.load([^[:alnum:]_]|$)|(^|[^[:alnum:]_])hotjar([^[:alnum:]_]|$)|(^|[^[:alnum:]_])plausible([^[:alnum:]_]|$)|(^|[^[:alnum:]_])posthog([^[:alnum:]_]|$)`;

export const DEPLOY_YML = `name: Deploy to R2

on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: deploy-\${{ github.repository }}
  cancel-in-progress: true

jobs:
  # Compliance GATE: deploy only runs if this passes. Games are untrusted user
  # content; these block the unambiguous policy violations (external scripts,
  # tracking SDKs) before anything reaches R2. Runtime egress is further
  # constrained by the freegamestore-host CSP.
  compliance:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - name: No external <script src> (games must be self-contained)
        run: |
          if grep -rhiE '<script[^>]*src=[^>]*https?://' web/*.html 2>/dev/null \\
             | grep -viE 'freegamestore\\.online|cloudflareinsights\\.com|googletagmanager\\.com|plausible\\.io'; then
            echo "::error::external <script src> is not allowed in a published game"; exit 1
          fi
      - name: No tracking SDKs in source
        run: |
          if grep -rEi "${TRACKER_GREP_ERE}" web/src/ 2>/dev/null; then
            echo "::error::tracking SDK found in web/src — analytics is platform-provided"; exit 1
          fi

  deploy:
    needs: compliance
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
          aws s3 sync ./web/dist "s3://fgs-games/games/$\{GITHUB_REPOSITORY##*/}/" \\
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
