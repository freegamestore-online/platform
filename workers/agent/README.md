# freegamestore-agent

VibeCode AI game builder — a Cloudflare Worker that lets users describe a game in chat and automatically scaffolds, deploys, and registers it on [freegamestore.online](https://freegamestore.online).

## What it does

- Accepts chat messages via a Durable Object (`AgentSession`) backed by SQLite
- Routes to an AI provider (Anthropic, OpenAI, Google, or GitHub Models)
- Generates game code from a template and pushes it to a new GitHub repo
- Provisions a Cloudflare Pages site and registers the game in the store
- Streams progress back to the client via Server-Sent Events

## Development

```bash
pnpm install
pnpm dev        # wrangler dev (local)
pnpm test       # vitest run
pnpm typecheck  # tsc --noEmit
pnpm lint       # biome check
```

Required secrets (set with `wrangler secret put <NAME>`):

| Secret | Purpose |
|---|---|
| `GITHUB_TOKEN` | Org-level PAT for repo provisioning and code push |
| `CF_API_TOKEN` | Cloudflare API token for Pages and DNS |
| `# (removed)` | Cloudflare Global API key (DNS) |
| `# (removed)` | Cloudflare account email (DNS) |

## Deploy

Push to `main` — GitHub Actions deploys automatically via `wrangler deploy`.

Live at: `https://agent.freegamestore.online`
