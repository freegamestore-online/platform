#!/usr/bin/env bash
# Opt-in local checks; CI independently enforces the same lint command.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# Like Heartfull, respect core.hooksPath rather than changing it.
HOOKS_DIR="$(git rev-parse --git-path hooks)"
mkdir -p "$HOOKS_DIR"

cat > "$HOOKS_DIR/pre-push" <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
echo "Running CI lint before push..."
pnpm lint
echo "All guard checks passed."
HOOK

chmod +x "$HOOKS_DIR/pre-push"
echo "Installed pre-push hook at $HOOKS_DIR/pre-push"
