#!/usr/bin/env bash
# Remove the stale `prebuild` hook from each game's web/package.json.
#
# The hook was:
#   "prebuild": "npx -y @freegamestore/cli@latest check"
#
# It runs the compliance CLI from inside the `web/` directory, which is
# the wrong cwd: LICENSE is one level up, web/index.html resolves to
# web/web/index.html, the VitePWA manifest source path doesn't match.
# Every game with this hook fails compliance with phantom errors.
#
# The reusable workflow already runs the same CLI from the repo root
# with a pinned version. The prebuild hook is redundant noise.
#
# Usage:
#   scripts/remove-stale-prebuild.sh           # dry-run
#   scripts/remove-stale-prebuild.sh --push    # apply + commit + push

set -eo pipefail

PUSH=0
for arg in "$@"; do
  case "$arg" in
    --push) PUSH=1 ;;
    *) echo "unknown arg: $arg" >&2; exit 1 ;;
  esac
done

GAMES_DIR="${HOME}/dev/stores/fgs/games"
migrated=0; skipped=0; failed=0

for repo in "$GAMES_DIR"/*/; do
  name=$(basename "$repo")
  pkg="$repo/web/package.json"
  [ -f "$pkg" ] || { skipped=$((skipped+1)); continue; }

  if ! grep -q '"prebuild":.*@freegamestore/cli' "$pkg"; then
    skipped=$((skipped+1))
    continue
  fi

  echo "→ $name"
  # Remove the prebuild line, plus dangling trailing comma on the line above
  # if it was the last entry of scripts:
  python3 -c "
import json, sys
p = '$pkg'
with open(p) as f: data = json.load(f)
if 'scripts' in data and 'prebuild' in data['scripts']:
    del data['scripts']['prebuild']
    with open(p, 'w') as f: json.dump(data, f, indent=2); f.write('\n')
    print('    removed prebuild')
else:
    print('    nothing to do')
"

  if [ "$PUSH" = "1" ]; then
    pushd "$repo" >/dev/null
    remote="origin"
    git remote get-url origin >/dev/null 2>&1 || remote="upstream"
    git add web/package.json
    if git diff --cached --quiet; then
      echo "    (no diff to commit)"
      popd >/dev/null
      skipped=$((skipped+1))
      continue
    fi
    if git commit -m "ci: drop stale prebuild hook calling @freegamestore/cli@latest

The hook ran the compliance CLI from inside web/, the wrong cwd:
LICENSE is one level up, web/index.html resolves to web/web/index.html,
and the VitePWA manifest source path can't match. Every game with this
hook fails compliance with phantom errors.

The reusable workflow at freegamestore-online/freegamestore runs the
same CLI from the repo root with a pinned version, so this prebuild
is redundant and actively breaking deploys.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>" >/dev/null 2>&1; then
      if git push "$remote" main >/dev/null 2>&1; then
        echo "    pushed (remote=$remote)"
        migrated=$((migrated+1))
      else
        echo "    push FAILED"
        failed=$((failed+1))
      fi
    else
      echo "    commit FAILED"
      failed=$((failed+1))
    fi
    popd >/dev/null
  else
    echo "    (dry-run; pass --push to commit + push)"
    migrated=$((migrated+1))
  fi
done

echo
echo "summary: $migrated handled, $skipped skipped, $failed failed"
