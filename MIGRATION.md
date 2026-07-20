# Private Platform Migration

Status: source imported, root deploy workflows added. Deploy cutover is complete
only after each workflow has run successfully from this repo and the old
standalone repo is made private or archived.

Imported from standalone repos:

- `apps/admin` from `freegamestore-online/admin`
- `apps/console` from `freegamestore-online/console`
- `workers/agent` from `freegamestore-online/agent`
- `workers/auth` from `freegamestore-online/auth`
- `workers/host` from `freegamestore-online/host`
- `workers/leaderboard` from `freegamestore-online/leaderboard`
- `workers/mcp` from `freegamestore-online/mcp`
- `jobs/auditor` from `freegamestore-online/auditor`

The old standalone repos can still deploy production until they are made private
or archived.

Required verification after pushing root workflows:

```bash
gh -R freegamestore-online/platform run list --limit 20
```

Do not archive a standalone repo until the corresponding monorepo deploy workflow
has shipped and the live route has been verified.
