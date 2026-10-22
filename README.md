# FreeGameStore Platform

The platform monorepo for [FreeGameStore](https://freegamestore.online): the storefront and SDK docs, creator studio, backend services, npm packages, and scheduled audits. Individual games and templates keep their own public repositories.

## Services

| Path | Purpose |
|------|---------|
| `sites/freegamestore` | Storefront and SDK docs |
| `apps/console` | Creator studio and its Pages Functions |
| `apps/admin` | Provisioning, registry, moderation, and operational tools |
| `workers/agent` | AI game builder |
| `workers/auth` | Authentication |
| `workers/host` | Game hosting from R2 through D1 routes |
| `workers/leaderboard` | Scores API |
| `workers/mcp` | MCP tools for creators and agents |
| `jobs/auditor` | Scheduled browser audits |
| `contracts` | Shared service contracts |

## Packages

| Package | npm | Purpose |
|---------|-----|---------|
| `packages/games-sdk` | [`@freegamestore/games`](https://www.npmjs.com/package/@freegamestore/games) | Game UI, authentication, sound, and game feel helpers |
| `packages/fgs-cli` | [`@freegamestore/cli`](https://www.npmjs.com/package/@freegamestore/cli) | CLI for scaffolding and publishing games |
| `packages/compliance` | [`@freegamestore/compliance`](https://www.npmjs.com/package/@freegamestore/compliance) | Compliance checks (brand, accessibility, security) |

## Development

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

The root pnpm workspace includes `packages/*`, `workers/*`, and `apps/admin`. The creator console has a nested workspace; the auditor, storefront, and SDK docs have separate installs and checks. See [CLAUDE.md](CLAUDE.md) and each service's `package.json` before choosing commands.

## Deployment

Production deploys run only through the existing GitHub Actions workflows on `main`. Each service deployment has path filters; publishing a game runs that game's own workflow, which calls the public [shared game pipeline](https://github.com/freegamestore-online/ci-workflows). Games upload to R2 and are served by the host Worker.

The storefront workflow tests and builds the storefront and SDK docs together, then uploads the combined artifact to the existing Cloudflare Pages project. Never deploy production from a local machine. Credentials remain in GitHub Actions secrets and Cloudflare Worker secrets, outside the source tree.

## npm publishing

OIDC trusted publishing via GitHub Actions. Bump version and push:

```bash
cd packages/games-sdk
npm version patch
git push --follow-tags
```

## License

MIT
