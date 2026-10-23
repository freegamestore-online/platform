# FreeGameStore Host Worker

Serves every published game from R2 via wildcard subdomain routing on `*.freegamestore.online`.

## How it works

1. Request arrives at `<game>.freegamestore.online`
2. Worker extracts the subdomain slug
3. Looks up the route in D1 `routes` table (shared with FAS, filtered by `zone = 'freegamestore.online'`)
4. Streams the asset from the `fgs-games` R2 bucket at `games/<slug>/<path>`
5. Adds security headers (CSP, HSTS, X-Frame-Options, etc.)

## Cross-origin isolation

A public game can opt in with `crossOriginIsolated: true` in its storefront registry entry. The host reads the deployed registry (cached for 60 seconds) and adds `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless` to all responses for that game. Absent/false preserves existing headers. The storefront uses new-tab play instead of an iframe for these games. No D1 migration is required. See the storefront SDK capabilities reference for asset and browser limitations. Live threaded-demo verification is tracked separately in #371.

## Infrastructure

| Resource | Value |
|----------|-------|
| Worker | `freegamestore-host` |
| Route | `*.freegamestore.online/*` |
| R2 bucket | `fgs-games` |
| D1 | `fas` (`a32701c0-5a56-4a12-810d-485166202e39`) — shared with FAS host, differentiated by `zone` column |

## Platform subdomains

Reserved subdomains (not served from R2):
- `www` — redirects to apex

The apex (`freegamestore.online`) is served by the storefront's CF Pages project, not this worker.

## Dev

```bash
pnpm install
pnpm test         # vitest run
pnpm lint         # biome check src/
pnpm typecheck    # tsc --noEmit
```

Deploy is via GitHub Actions (`wrangler deploy`).

## Relationship to FAS host

This is the FGS sibling of `fas/host/`. Same architecture (D1 route lookup + R2 streaming), separate bucket (`fgs-games` vs `fas-apps`), shared D1.
