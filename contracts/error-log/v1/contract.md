# Error-log contract v1

`contract.ts` is the authoritative definition for the durable `error_log` row:
its D1 schema, row types, validation, field limits, lazy table creation, and
best-effort insert behaviour. `source` and `message` are required non-blank
strings. Empty optional fields become `NULL`.

| Field | Maximum characters |
| --- | ---: |
| `source` | 200 |
| `user` / `user_github` | 200 |
| `context` | 1,000 |
| `message` | 2,000 |
| `stack` | 4,000 |
| browser `route` metadata | 200 |

## Deployment boundary

The admin service is a Cloudflare **Worker** and the publisher is a separate
Cloudflare **Pages Functions** deployment. Both bind the same `freegamestore`
D1 database, but they are deployed and isolated independently. The source-only
contract is imported by relative path and bundled into each deploy; it is not a
third deployed Worker and does not create a package-install or service-binding
dependency. Each bundle maintains its own lazy-init cache, while the shared
schema makes concurrent first writes safe through `CREATE TABLE IF NOT EXISTS`.

The agent Worker does **not** bind this D1 database (its `DB` is the
`leaderboard` database). It must never call the persistence helper. It imports
only the row validation/limits and sends a versioned-contract row to
`POST /api/internal/error` through the `ADMIN` service binding. The admin
endpoint is the authoritative persistence boundary; its integration test invokes
the agent reporter against the real endpoint.
