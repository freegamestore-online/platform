# @freegamestore/platform

Platform monorepo for [FreeGameStore](https://freegamestore.online) — publishable npm packages for game development and publishing.

## Packages

| Package | npm | Purpose |
|---------|-----|---------|
| `packages/games-sdk` | [`@freegamestore/games`](https://www.npmjs.com/package/@freegamestore/games) | React UI primitives (GameShell, GameTopbar, useAuth, useLeaderboard) |
| `packages/fgs-cli` | [`@freegamestore/cli`](https://www.npmjs.com/package/@freegamestore/cli) | CLI for scaffolding and publishing games |
| `packages/compliance` | [`@freegamestore/compliance`](https://www.npmjs.com/package/@freegamestore/compliance) | Compliance checks (brand, accessibility, security) |

## Development

```bash
pnpm install
pnpm build
pnpm typecheck
```

## Publishing

OIDC trusted publishing via GitHub Actions. Bump version and push:

```bash
cd packages/games-sdk
npm version patch
git push --follow-tags
```

## License

MIT

---

# FreeGameStore Platform

Private operational monorepo for FreeGameStore apps, workers, and jobs.

Public creator-facing packages live in `freegamestore-online/public`.
Public game repos, templates, storefront/docs, and the reusable game workflow
remain public.

## Layout

```text
apps/
  admin/
  console/
workers/
  agent/
  auth/
  host/
  leaderboard/
  mcp/
jobs/
  auditor/
```

Each imported project remains self-contained with its own package manager files
and deployment configuration. Deploy workflows are ported one service at a time
before the old standalone repo is archived.

See `MIGRATION.md` for current cutover status.
