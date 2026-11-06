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
- `# (removed)` — Cloudflare global key
- `# (removed)` — Cloudflare account email
- `GITHUB_TOKEN` — GitHub personal access token

The admin UI's Vite dev server proxies `/api` to `wrangler dev`, so it needs no CORS. For its
cookie writes to pass the origin check, set `DEV_ORIGIN=http://localhost:5173` in `.dev.vars`
(gitignored). It is unset in production, where no `localhost` origin is trusted (#486).

## Deploy

Push to `main` — GitHub Actions deploys via Wrangler automatically.

Route: `admin.freegamestore.online/*`
