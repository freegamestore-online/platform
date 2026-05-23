# freegamestore-auth

Google OAuth + JWT authentication worker for freegamestore.online.

Handles sign-in via Google OAuth 2.0, issues HttpOnly JWT cookies scoped to `.freegamestore.online`, and persists users in D1.

## Endpoints

| Method | Path        | Description                              |
|--------|-------------|------------------------------------------|
| GET    | `/login`    | Redirect to Google OAuth consent screen  |
| GET    | `/callback` | Exchange code, set cookie, redirect back |
| GET    | `/me`       | Return current user from cookie          |
| POST   | `/logout`   | Clear cookie, redirect to referrer       |

Deployed at `auth.freegamestore.online`.

## Development

```bash
pnpm install
pnpm dev          # wrangler dev (requires .dev.vars with secrets)
```

Create `.dev.vars` (gitignored):

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
JWT_SECRET=...
```

## Deploy

Push to `main` — GitHub Actions deploys automatically via Wrangler.

## Tests

```bash
pnpm test
```

Uses Node's built-in `node:test` runner — no extra dependencies.
