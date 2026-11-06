# Agent Instructions

## Delivery mode

**Issue first, then straight to `main`. No pull requests** unless Serge asks for one
for that specific issue. This replaces the 2026-08-16 rule (Serge, 2026-09-25,
serge-ivo/oc-config#54).

**Production deployments are automated only through GitHub Actions on main. Never deploy production from a local machine, including during an Actions outage.** Run checks locally; report billing, credential, or external permission blockers to Serge without requesting or exposing plaintext secrets. See CLAUDE.md for release verification.

## Hard rules

1. **No pull requests, and no work without a filed issue.** Read the issue and all its comments before editing. Commit and push finished work directly to `main` (`git push origin HEAD:main`), after fetching and rebasing onto it; never force-push. A local branch or worktree is fine for isolating parallel work, as long as it lands on `main` and no PR is opened. Do not run `gh pr create` unless Serge asks for a PR for that issue.
2. **`Closes #N` only when the issue is fully resolved**, otherwise `Refs #N`.
3. **Secrets go through `~/dev/ops`** (`ops put`), never `wrangler secret put` by hand, and never into an issue, commit or log. Prepare the exact step for Serge.
