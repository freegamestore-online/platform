# Agent Instructions

## Delivery mode

**Straight to `main`. No branches, no pull requests.** Declared 2026-08-16.

**Interim (since 2026-10-15): GitHub Actions is down for this PRIVATE platform repo (public game repos still build and deploy themselves), so a push here deploys nothing.** Run the checks locally. Deploy only in a run for a filed `Deploy: …` issue, from the local machine. The commands and credentials are in `CLAUDE.md` § "Interim: deploy from local while GitHub Actions is down".

## Hard rules

1. **No branches. No pull requests. Ever.** Commit directly to `main`. Do not run `git checkout -b`, `git switch -c`, or `gh pr create`. If you find yourself on a non-`main` branch, stop and report it. (Declared 2026-08-16.)
