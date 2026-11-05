# Plan: consolidate FGS platform tools into one `platform` monorepo

> **Status: DONE — historical.** Kept as the record of the plan; the text below is
> unchanged from 2026-06-30 and describes a target that shifted during execution.
> The services were merged into this repo on 2026-08-10 (`919e9f9`) and every
> standalone service repo (`admin`, `agent`, `auditor`, `auth`, `console`,
> `freegamestore`, `host`, `leaderboard`, `mcp`) is now archived on GitHub.
> Where the result differs from the plan:
> - `admin` and the console landed in `apps/{admin,console}/` (not `workers/admin`,
>   `sites/publisher`); the auditor is `jobs/auditor/` (not `packages/auditor`).
> - The root workspace includes `workers/*` and `apps/admin`, not `packages/*` only.
> - FGS has its own D1 (`freegamestore`); the FAS `fas` D1 coupling is gone.
> - The leaderboard was moved and deployed, then taken out of service (#424, 410).
> - `brand` and `submissions` stayed standalone repos.
>
> Current layout, build and deploy rules: [`CLAUDE.md`](CLAUDE.md).

Status: proposed (not started)
Author: drafted 2026-06-30
Model: the FAS consolidation (`fas/platform/workers/` + `PLAN-CONSOLIDATE-WORKERS.md`,
done 2026-06-02). This plan mirrors that proven shape for FGS and **fixes the one
thing FAS got wrong** — FAS moved workers in but never archived the old standalone
repos, leaving duplicate Workers with identical names racing to deploy.

## Goal

One repo — `freegamestore-online/platform` — holds every FGS *platform tool*
currently scattered across separate repos. User-facing artifacts (games,
templates) stay one-repo-per-artifact; they are the product, not platform tooling.

This directly removes the class of bug that caused the leaderboard outage:
a separate repo that was stale, had no CI, and wasn't in the org secret's
repo-access list. One repo = one CI, one secret scope, one source of truth, no
cross-repo drift (e.g. SDK shipped `/v1` but the worker didn't).

## Core invariant (why this is safe)

Cloudflare resource identities are **account-global and unchanged by which repo
deploys them**: Worker names (`freegamestore-*`), Pages project names
(`freegamestore-publisher`), routes, custom domains, D1/KV/R2 binding ids, and
**Worker secrets** (`JWT_SECRET`, etc.) all live in the CF account, not the repo.
Moving a tool's source into the monorepo and deploying from there updates the
*same* resource in place — there is no second Worker, no new Pages project, no lost
secret, no D1 re-binding. The only thing that changes is which repo holds the
source and runs the deploy. That is precisely why the clean cut is safe: archiving
the old repo removes a redundant *source*, not a resource. (Corollary: the FAS
"duplicate Workers" problem was never duplicate *resources* — it was two *sources*
deploying to one Worker name. Archiving kills the second source.)

## Target structure

```
platform/
├── packages/            # npm libraries — IN the root pnpm workspace
│   ├── games-sdk/       #   @freegamestore/games   (already here)
│   ├── fgs-cli/         #   @freegamestore/cli      (already here)
│   ├── compliance/      #   @freegamestore/compliance (already here)
│   └── auditor/         #   scheduled compliance auditor (private, unpublished; run by a cron workflow, not deployed)
├── workers/             # Cloudflare Workers — self-contained pnpm projects, OUTSIDE the workspace
│   ├── host/            #   freegamestore-host       (*.freegamestore.online)
│   ├── admin/           #   freegamestore-admin      (admin.*)
│   ├── agent/           #   freegamestore-agent      (agent.*)
│   ├── auth/            #   freegamestore-auth       (auth.*)
│   ├── leaderboard/     #   freegamestore-leaderboard (leaderboard.*)  ← fixes the open outage
│   └── mcp/             #   freegamestore-mcp        (mcp.*)
├── sites/               # Pages / static apps — self-contained projects
│   ├── freegamestore/   #   storefront (Pages, apex) + Starlight docs
│   └── publisher/       #   combined console app: web/ frontend + functions/ (/api, /auth)
├── docs/                # API-CONTRACT.md etc. (already here)
└── (brand/, submissions/ — optional: fold as plain dirs or leave; trivial)
```

Stays separate (do NOT fold):
- `games/*` — one-repo-per-game is the product model; creators own these.
- `templates/*` — consumed by `fgs publish`; scaffolding artifacts.

## The pattern (copied from FAS, do not re-invent)

1. **`packages/*` are workspace members** (root `pnpm-workspace.yaml`), shared TS/vitest/biome.
2. **`workers/<name>/` are NOT workspace members.** Each is a self-contained pnpm
   project with its own `package.json`, lockfile, `tsconfig`, `biome.json`, tests.
   Reason: deploy isolation — a worker installs/tests/deploys without dragging in
   the npm-publish workspace, and each can pin its own toolchain (FAS keeps them out
   for exactly this; verify per-FGS-worker whether toolchains actually differ, but
   isolation alone justifies it). Add a `pnpm-workspace.yaml` root marker inside
   each worker dir so a nested `pnpm install` resolves against itself (or install
   with `--ignore-workspace`). Root `pnpm-workspace.yaml` globs `packages/*` only,
   so `workers/`/`sites/` are already outside it; the biome ignore (Phase 0.6) is
   the remaining exclusion to add.
3. **`sites/<name>/` same isolation** as workers (own toolchain, own lockfile).
4. **CI = one workflow per deployable**, `deploy-<name>.yml`, path-filtered:
   ```yaml
   on:
     push:
       branches: [main]
       paths: ['workers/<name>/**', '.github/workflows/deploy-<name>.yml']
     workflow_dispatch:
   concurrency: { group: deploy-<name>, cancel-in-progress: true }
   jobs:
     deploy:
       defaults: { run: { working-directory: workers/<name> } }
       steps: [checkout, pnpm setup, node 22, install --frozen-lockfile,
               typecheck, test, pnpm exec wrangler deploy]
       env: { CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID }   # repo/org secrets
   ```
   Only the changed deployable redeploys. `sites/*` use `pages deploy` or R2-sync
   in the same path-filtered shape.

## Migration mechanics (per repo)

> Do **Phase 0** (below) first — it lists the prerequisites that gate every move.

Preserve history. **Sync the source first** (commit + push; ensure local `main` ==
`origin/main`, or subtree straight from the GitHub URL) — subtree captures the
committed ref, so a stale or dirty source silently migrates the wrong code. Then:

```bash
cd fgs/platform                                 # working tree must be clean
git remote add <name>-src ../<name>            # or the GitHub URL (safer: avoids stale local)
git fetch <name>-src
git subtree add --prefix=workers/<name> <name>-src main   # sites/<name> for SPAs
git remote remove <name>-src
```

`git subtree add` without `--squash` keeps full history under the prefix. Then:
1. Drop the repo's own `.github/` workflows, but **port any non-deploy workflows**
   into the monorepo path-scoped (crons: the storefront's commit-cache refresh, the
   `auditor` weekly audit) — these are easy to forget and silently stop running.
2. Add the `pnpm-workspace.yaml` root marker inside the dir (or note `--ignore-workspace`).
3. **Worker:** confirm `wrangler.toml` `name` + `routes` are intact (the route is what
   makes it reachable). **Pages site:** there is no `route` — reachability is the
   Pages custom domain (storefront apex) or the `host` worker proxy (`publisher` via
   `console.`/`publish.`); confirm the project name in the `pages deploy` command.
4. `cd workers/<name> && pnpm install && pnpm test && pnpm run typecheck` to verify
   the build locally. **Do not `wrangler deploy` from local** — the local token can't
   register routes (Phase 0.2); deploy happens via CI.
5. Add `.github/workflows/deploy-<name>.yml` (path-filtered).
6. Commit. Push. Confirm the **CI** deploy is green and the live route/domain responds.
7. **Clean cut:** archive the standalone repo on GitHub (Settings → Archive). Archiving
   makes the repo read-only and **disables its Actions**, so its old workflow can never
   deploy the same Worker name again — this is the mechanism that prevents FAS's
   duplicate-deploy race. Do NOT delete (archive is reversible; delete is not) until the
   monorepo deploy is verified live for at least one cycle.

## Phase 0 — prerequisites (verify before any move)

1. **Secret access is already satisfied — this is *why* consolidation fixes the
   bug class.** `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` are org secrets
   (Doppler `fgs` project) whose access covers **public** repos. Empirically:
   every public FGS worker repo (`host`, `auth`, `agent`, `mcp`) deploys fine; the
   **private** ones (`leaderboard`, `admin`) get an empty token and fail. `platform`
   is **public** (verified), so workers deployed *from it* inherit secret access
   with **no grant needed** — including `admin`, which can't deploy from its own
   private repo today. No Phase-0 secret action required; Phase 1 validates it live.
2. **CI token has zone route permission; the local token does not.** The org
   `CLOUDFLARE_API_TOKEN` can register Worker `routes` (proven: `host`/`auth`/`agent`
   deploys attach their routes). A local `wrangler deploy` from this machine
   *cannot* (token lacks Workers-Routes edit on the `freegamestore.online` zone —
   this is what blocked the manual leaderboard fix). **Deploys must go through CI**,
   not local `wrangler`.
3. **`platform` currently has no Worker-deploy workflows** (only `publish.yml` npm +
   ci/quality/smoke). The `deploy-<name>.yml` files are net-new and coexist with
   `publish.yml`; their path filters keep them independent.
4. **Commit + push every source repo first.** `git subtree add` only captures the
   *committed* ref — uncommitted work is silently dropped. (`create` and `publisher`
   in FAS currently have uncommitted changes; check FGS sources the same way.)
5. **Clean monorepo tree** before each `git subtree add` (commit/stash first).
6. **Extend the root `biome.json`** to ignore `workers/**` and `sites/**` (FGS's
   root `biome.json` does *not* exclude them yet — unlike FAS). Otherwise root
   biome will try to lint the self-contained projects with the wrong config.

## Rollout order (lowest risk first)

1. **`leaderboard`** — already broken, nothing to lose, validates the worker path
   end-to-end and closes the open outage in the same move. Brings route + `/v1`
   into a repo that CI can actually deploy.
2. **`mcp`** — standalone worker, low blast radius.
3. **`auth`** — careful: it's the identity provider the publisher now depends on.
   Verify `/login`, `/callback/github`, `/v1/me` after.
4. **`admin`, `agent`** — provisioning + VibeCode; verify a publish + a build after.
5. **`host`** — highest blast radius (serves every game). Do last, verify a live
   game + `console.`/`publish.` proxies after.
6. **`sites/publisher`, `sites/freegamestore`** — Pages apps; verify sign-in +
   storefront.
7. **`auditor`**, then optional `brand`/`submissions`.

After each: archive the source repo. Never run both.

## Verification per move

- Worker: `curl` its real route returns expected (not 404); `wrangler deployments
  list` shows the new version sourced from the monorepo commit.
- `host`: a live game subdomain + `console.freegamestore.online` still serve.
- `publisher`: GitHub sign-in round-trips; `/auth/me` returns the user.
- **Authed paths** (`leaderboard` score submit, `publisher` session): confirm they
  work, i.e. the Worker secrets (`JWT_SECRET`) are still present. Per the Core
  invariant they persist across the repo move, but verify rather than assume — a
  Worker that was never successfully deployed may never have had its secret set.
- No standalone repo left un-archived with a live deploy workflow.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Duplicate Workers racing** (FAS's mistake) | Archive each standalone repo immediately after the monorepo deploy verifies. One Worker name, one source. |
| Toolchain clash between workers and `packages/*` | Keep workers OUT of the workspace (own lockfile/tsconfig/biome), exactly as FAS does. |
| Lockfile drift on move | `pnpm install` inside each dir after subtree; commit the refreshed lockfile. |
| Secret access | `platform` is public → already in the org secret scope (Phase 0.1), so no grant needed. Local `wrangler deploy` is **not** a fallback (token lacks zone route perms, Phase 0.2); if CI is wedged, use `workflow_dispatch` on the deploy workflow, not a local deploy. |
| History loss | Use `git subtree add` (keeps history) not a bare copy. |
| Big-bang breakage | One repo at a time, verify live, then next. Never move two deployables in one PR. |

## Decoupling-from-FAS (do alongside)

Consolidation is the moment to cut FGS's runtime coupling to FAS (tracked separately):
- `host`/`admin` bind FAS's `fas` D1 — give FGS its own D1 and migrate the `routes`
  rows (zone `freegamestore.online`).
- The CLI's generated game `deploy.yml` uploads to `s3://fas-apps` — should be
  `fgs-games`.
- A game imports `@freeappstore/quality` — vendor it into FGS or drop it.
(Full coupling audit is a separate doc; finish that first, then land both.)

## Open item carried in

`leaderboard.freegamestore.online` is currently **down** (404): the route + `/v1`
alias are committed and a CI `deploy.yml` was added, but the worker was never
deployed because the **private** `leaderboard` repo gets an empty token (org secret
covers public repos only). Phase 1 of this plan resolves it durably. Simplest
*interim* unblock (before consolidation): make the `leaderboard` repo **public**
(matching its sibling workers `host`/`auth`/`agent`/`mcp`, and aligned with the
store's open-source ethos) → the existing `deploy.yml` then has secret access and
ships the route + `/v1`. Granting the private repo access to the two secrets is the
alternative, but needs `admin:org` (the active `serge-ivo` gh token lacks it).

## Rollback

Each move is one commit + one archived repo. To roll back: un-archive the source
repo, re-run its old deploy workflow (it redeploys the same Worker name — the Core
invariant means it lands on the same resource), then revert the monorepo subtree-add
commit (`git revert -m 1 <sha>`).

Caveat: rollback is clean **only before further monorepo edits** to that tool. Once
you've changed the worker inside the monorepo, the archived repo is stale — port
those changes back to it first, or you'll roll back to old code. Practically: don't
edit a moved tool in the monorepo until its move has soaked for a cycle. Because
moves are sequential and verified, rollback scope is always a single deployable.
