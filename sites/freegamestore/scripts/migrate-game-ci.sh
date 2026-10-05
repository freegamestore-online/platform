#!/usr/bin/env bash
# Migrate every sibling game under ~/dev/stores/fgs/games/* to call the
# centralized reusable workflow at freegamestore-online/freegamestore.
# Idempotent: re-run safely. Skips a repo if its deploy.yml already
# matches the new shape.
#
# Usage:
#   scripts/migrate-game-ci.sh [--push]      # default: dry-run
#   scripts/migrate-game-ci.sh --push        # also commits + pushes
#   scripts/migrate-game-ci.sh --only=name,name  # subset of games
#
# Per-game CF project name follows the convention free<game>app. Override
# by setting the variable in CF_PROJECT_OVERRIDES below for any exception.

set -eo pipefail

PUSH=0
ONLY=""
for arg in "$@"; do
  case "$arg" in
    --push) PUSH=1 ;;
    --only=*) ONLY="${arg#--only=}" ;;
    *) echo "unknown arg: $arg" >&2; exit 1 ;;
  esac
done

# Per-game CF project name. Convention is free<game>app; override here for
# games where the project name in Cloudflare Pages was registered differently.
cf_project_for() {
  case "$1" in
    puzzle) echo "freepuzzle" ;;
    *)      echo "free$1app" ;;
  esac
}

GAMES_DIR="${HOME}/dev/stores/fgs/games"
if [ ! -d "$GAMES_DIR" ]; then
  echo "games dir not found: $GAMES_DIR" >&2
  exit 1
fi

read_only_set() {
  if [ -z "$ONLY" ]; then return 1; fi
  IFS=',' read -ra arr <<< "$ONLY"
  for x in "${arr[@]}"; do
    if [ "$x" = "$1" ]; then return 0; fi
  done
  return 1
}

render_workflow() {
  local cf_project="$1"
  cat <<EOF
name: CI / Deploy

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

# Most-recent push/PR for a ref wins; older runs are cancelled so a deploy
# never wins a race against a fresh build of the same branch.
concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  ci-and-deploy:
    uses: freegamestore-online/freegamestore/.github/workflows/game-ci.yml@main
    with:
      cf_project: ${cf_project}
    permissions:
      contents: read
      deployments: write
    secrets: inherit
EOF
}

migrated=0
skipped=0
failed=0

for repo in "$GAMES_DIR"/*/; do
  name=$(basename "$repo")
  if [ -n "$ONLY" ] && ! read_only_set "$name"; then continue; fi

  cf_project=$(cf_project_for "$name")

  if [ ! -d "$repo/.git" ]; then
    echo "skip $name (not a git repo)"
    skipped=$((skipped+1))
    continue
  fi

  mkdir -p "$repo/.github/workflows"
  new_yaml=$(render_workflow "$cf_project")

  # Always (re)write deploy.yml and remove redundant old workflows. Let git
  # decide whether anything actually changed — that way we catch the case
  # where deploy.yml content is already correct but ci.yml/compliance.yml
  # still sit on remote, OR where the local file was updated previously
  # but never committed/pushed.
  printf '%s\n' "$new_yaml" > "$repo/.github/workflows/deploy.yml"
  rm -f "$repo/.github/workflows/ci.yml" "$repo/.github/workflows/compliance.yml"

  pushd "$repo" >/dev/null

  # Some repos use "origin", others use "upstream". Pick whichever exists.
  remote="origin"
  if ! git remote get-url origin >/dev/null 2>&1; then
    if git remote get-url upstream >/dev/null 2>&1; then
      remote="upstream"
    else
      echo "   no usable remote (origin/upstream); skipping"
      popd >/dev/null
      failed=$((failed+1))
      continue
    fi
  fi

  git add -A .github/workflows/ >/dev/null
  has_staged_changes=0
  if ! git diff --cached --quiet -- .github/workflows/; then
    has_staged_changes=1
  fi
  has_unpushed_commits=0
  if ! git diff --quiet "$remote/main" HEAD -- .github/workflows/ 2>/dev/null; then
    has_unpushed_commits=1
  fi

  if [ "$has_staged_changes" = "0" ] && [ "$has_unpushed_commits" = "0" ]; then
    echo "skip $name (already up-to-date locally and on remote)"
    popd >/dev/null
    skipped=$((skipped+1))
    continue
  fi

  echo "→ $name  (cf_project=$cf_project)"
  if [ "$PUSH" = "1" ]; then
    if [ "$has_staged_changes" = "1" ]; then
      if ! git commit -m "ci: switch deploy.yml to reusable game-ci workflow

Caller for freegamestore-online/freegamestore's reusable workflow.
Pipeline definition is centralized; per-game file is just the
cf_project plumbing." >/dev/null 2>&1; then
        echo "   commit FAILED"
        failed=$((failed+1))
        popd >/dev/null
        continue
      fi
    fi
    if git push "$remote" main >/dev/null 2>&1; then
      echo "   pushed (remote=$remote)"
    else
      echo "   push FAILED (remote=$remote)"
      failed=$((failed+1))
      popd >/dev/null
      continue
    fi
  else
    echo "   (dry-run; pass --push to commit + push)"
  fi
  popd >/dev/null
  migrated=$((migrated+1))
done

echo
echo "summary: $migrated migrated, $skipped skipped, $failed failed"
if [ "$PUSH" = "0" ] && [ "$migrated" -gt 0 ]; then
  echo "re-run with --push to commit + push these changes."
fi
