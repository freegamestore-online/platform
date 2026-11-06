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

### Local dev origin

No `localhost` origin is trusted in production (#486). To let a local page call auth (CORS on `/me`, and `POST /logout`) with
credentials, name its exact origin in `.dev.vars` (gitignored, never deployed):

```
DEV_ORIGIN=http://localhost:5173
```

Leave it unset everywhere else: it is not in `wrangler.toml` and must never be set as a
production var or secret.

## Deploy

Push to `main` — GitHub Actions deploys automatically via Wrangler.

## Tests

```bash
pnpm test
```

Uses Node's built-in `node:test` runner — no extra dependencies.
