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
