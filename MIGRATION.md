# Private Platform Migration

Status: source imported, deploy cutover not enabled.

Imported from standalone repos:

- `apps/admin` from `freegamestore-online/admin`
- `apps/console` from `freegamestore-online/console`
- `workers/agent` from `freegamestore-online/agent`
- `workers/auth` from `freegamestore-online/auth`
- `workers/host` from `freegamestore-online/host`
- `workers/leaderboard` from `freegamestore-online/leaderboard`
- `workers/mcp` from `freegamestore-online/mcp`
- `jobs/auditor` from `freegamestore-online/auditor`

The old standalone repos still own production deploys until this repo has
repo-level GitHub Actions secrets and path-scoped deploy workflows.

Required next step before deploy cutover:

```bash
gh secret set CLOUDFLARE_API_TOKEN -R freegamestore-online/platform
gh secret set CLOUDFLARE_ACCOUNT_ID -R freegamestore-online/platform
```

Additional secrets are needed before porting scheduled/audit jobs:

```bash
gh secret set GH_ADMIN_TOKEN -R freegamestore-online/platform
```

Do not archive or disable a standalone repo until the corresponding monorepo
deploy workflow has shipped and the live route has been verified.
