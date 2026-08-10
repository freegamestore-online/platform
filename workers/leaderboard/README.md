# freegamestore-leaderboard

Cloudflare Worker that provides a leaderboard API for [freegamestore.online](https://freegamestore.online) games, backed by Cloudflare D1.

## API

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/scores` | Submit a score |
| `GET` | `/api/leaderboard/:game` | Top scores for a game |
| `GET` | `/api/leaderboard/:game/recent` | Recent scores for a game |
| `GET` | `/api/leaderboard/overall` | Cross-game leaderboard |
| `GET` | `/api/leaderboard/:game/user/:userId` | User's best score + rank |

Authenticated submissions use the `fgs_token` JWT cookie issued by the auth worker. Anonymous submissions are accepted but excluded from ranked leaderboards.

## Development

```bash
pnpm install

# Init local D1 database
pnpm db:init:local

# Start local dev server
pnpm dev
```

## Deploy

Push to `main` — GitHub Actions deploys automatically via `wrangler deploy`.

The `JWT_SECRET` must be set as a Wrangler secret:

```bash
wrangler secret put JWT_SECRET
```
