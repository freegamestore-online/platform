# Agent Instructions

## Delivery mode

**Straight to `main`. No branches, no pull requests.** Declared 2026-08-16.

**Production deployments are automated only through GitHub Actions on main. Never deploy production from a local machine, including during an Actions outage.** Run checks locally; report billing, credential, or external permission blockers to Serge without requesting or exposing plaintext secrets. See CLAUDE.md for release verification.

## Hard rules

1. **No branches. No pull requests. Ever.** Commit directly to `main`. Do not run `git checkout -b`, `git switch -c`, or `gh pr create`. If you find yourself on a non-`main` branch, stop and report it. (Declared 2026-08-16.)
