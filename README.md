# freegamestore-admin

Cloudflare Worker for monitoring and moderation of [freegamestore.online](https://freegamestore.online). Serves the admin dashboard at `admin.freegamestore.online`.

## What it does

- Renders a dashboard shell with uptime/quality stats for each game
- Handles game publish provisioning (GitHub repo + Cloudflare Pages)
- Exposes internal API routes used by the platform admin UI

## Development

```bash
pnpm install
pnpm exec wrangler dev
```

Secrets required locally (set via `wrangler secret put` or `.dev.vars`):

- `CF_API_TOKEN` — Cloudflare API token
- `CF_GLOBAL_KEY` — Cloudflare global key
- `CF_EMAIL` — Cloudflare account email
- `GITHUB_TOKEN` — GitHub personal access token

## Deploy

Push to `main` — GitHub Actions deploys via Wrangler automatically.

Route: `admin.freegamestore.online/*`
