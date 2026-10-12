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

`pnpm-workspace.yaml` covers **`packages/*` only**. The root scripts are
`pnpm -r …`, so they recurse the workspace and therefore touch *just the three
npm packages*:

```bash
pnpm install && pnpm build && pnpm test    # packages/ ONLY — not apps/, not workers/
```

Each app, worker, and job is self-contained, with its own `package.json` and its
own `pnpm-lock.yaml`. To work on one, install and run **from its own directory**:

```bash
cd workers/agent && pnpm install && pnpm test
cd apps/console  && pnpm install && pnpm test    # also: test:web, test:functions
```

A green root `pnpm test` says nothing about the agent or the console. Run the
service's own suite before claiming a change passes.

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
