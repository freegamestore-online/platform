# FreeGameStore Platform

The **full-service monorepo** for FreeGameStore: every app, worker, and job that
runs the store, plus the npm-published libraries. If you were told this repo
holds "only the npm packages," that is out of date — it stopped being true when
the service repos were merged in here (`919e9f9`).

Services are **not** separate repos anymore. There is no `~/dev/stores/fgs/console`
or `~/dev/stores/fgs/agent` to navigate to. Those directories still exist on some
machines as stale pre-consolidation clones — do not edit them; their changes go
nowhere.

## Layout

```text
apps/
  console/    Creator studio — Cloudflare Pages `freegamestore-publisher`
              web/        React SPA (the Studio UI)
              functions/  Pages Functions (/api/create, etc.)
  admin/      Admin + provisioning Worker — admin.freegamestore.online
              src/        Worker (publish/provision, registry, error log)
              web/        Admin UI
workers/
  agent/      AI game-builder Durable Object — agent.freegamestore.online
  auth/       Google OAuth + JWT — auth.freegamestore.online
  host/       R2 static host — *.freegamestore.online
  leaderboard/  D1 scores REST API — leaderboard.freegamestore.online
  mcp/        MCP server — mcp.freegamestore.online
jobs/
  auditor/    Playwright quality-audit runner
packages/
  games-sdk   @freegamestore/games   React primitives (GameShell, useAuth, …)
  fgs-cli     @freegamestore/cli     scaffold + publish CLI
  compliance  @freegamestore/compliance  brand/a11y/security checks
```

Quick map for the code you are most often sent to:

| You want | Path |
|---|---|
| Creator studio UI | `apps/console/web/src/` |
| Studio API endpoints | `apps/console/functions/` |
| Admin worker (provision, registry, errors) | `apps/admin/src/` |
| Agent (build/deploy tools, prompts, sanity checks) | `workers/agent/src/` |
| `game_info` and other MCP tools | `workers/mcp/src/` |

## The workspace gotcha — read before running anything

Read the current `pnpm-workspace.yaml`: the root workspace includes
**`packages/*`, `workers/*`, and `apps/admin`**. Root `pnpm -r …` scripts run
workspace members that define the requested script:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

For root workspace services, install and build from the root, then use the
service's package name to run its checks. The creator console has its own
nested workspace (`apps/console` plus `web`) and installs separately:

```bash
pnpm --filter @freegamestore/agent test
pnpm --dir apps/console install --frozen-lockfile
pnpm --dir apps/console test
```

`jobs/auditor` and `sites/freegamestore/docs` install with their own lockfiles
and `--ignore-workspace`; the storefront uses Node's test runner. These and the
console are outside root test coverage. The admin web frontend also has its
own install/build. Check the relevant existing workflow and `package.json`
instead of assuming every directory is an independent pnpm project.

Script coverage is uneven — `workers/agent` has `dev/deploy/typecheck/test/lint`,
while `apps/admin` has only `test`. Check the service's `package.json` rather
than assuming a script exists. Lint and format are repo-wide via Biome
(`pnpm lint`, `pnpm format`) from the root.

## Deploys

Per-service GitHub Actions workflows in `.github/workflows/`, each path-filtered
to its own directory — `deploy-console.yml`, `deploy-agent.yml`, `deploy-admin.yml`,
`deploy-auth.yml`, `deploy-host.yml`, `deploy-leaderboard.yml`, `deploy-mcp.yml`.
Editing `workers/agent/**` deploys only the agent.

Everything except the console is a Worker with a route in its `wrangler.toml`.
The console is a **Pages** project (`pages_build_output_dir = "web/dist"`), so it
has Pages Functions rather than a Worker entrypoint.

`publish.yml` handles npm releases for `packages/*` via OIDC trusted publishing.
`weekly-audit.yml`, `quality.yml`, `fleet-health.yml`, and `prod-smoke.yml` are
scheduled/CI health jobs, not deploys.

Secrets are set per Worker with `wrangler secret put` and in GitHub Actions —
never committed. See `SECURITY.md`.

## Notes

- **The console has real users.** Changes to the agent or the console need tests
  and review before shipping.
- Games are provisioned **before** their first build (repo + host route + registry
  entry), so a game can be routable and listed while its code has never compiled.
  That ordering is deliberate — it lets a failed first build recover via
  `push_update` instead of stranding the id — so do not "fix" it by registering
  late.
- `MIGRATION.md` tracks the consolidation cutover; `SESSION-HANDOFF.md` carries
  in-flight context between sessions.

## Delivery mode

**Straight to `main`. No branches, no pull requests.** Declared 2026-08-16.

## Production deployment policy

Production deployments are automated only through GitHub Actions on `main`.
Never deploy production from a local machine, even for a deploy ticket or during
an Actions outage. Local installs, tests, and builds are allowed. Never request,
print, copy, or transmit plaintext credentials. Serge must manage missing or
invalid Actions secrets through GitHub settings, and resolve account billing or
external permission failures. Do not change account access or spending settings.

The storefront workflow is `.github/workflows/deploy-storefront.yml`. It runs
storefront tests, builds the storefront, installs SDK docs dependencies from the
committed lockfile, builds docs into `sites/freegamestore/dist/docs`, and verifies
the combined artifact before deploying to the existing `freegamestore` Pages
project. Storefront pushes trigger it; `workflow_dispatch` on `main` supports a
retry after an outage. Do not dispatch other services for a storefront release.
Existing Actions secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are used
only by the remote deployment step.

If Actions cannot start, inspect the run annotation and job/runner metadata.
A billing rejection before any steps run is not a build failure and cannot be
fixed by changing application code or substituting a local deploy. Record the
run URL and exact blocker on the issue and leave it open for Serge.

A release is complete only after a remotely executed deployment succeeds.
Record the Actions run URL, deployed commit SHA and Pages deployment URL, then
verify live HTTP HTML, referenced CSS/assets, a game detail page, and `/docs/`
(including its assets). Storefront changes prohibit browser tests. Leave release
and implementation issues open until their acceptance criteria are evidenced.
