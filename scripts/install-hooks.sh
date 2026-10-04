#!/usr/bin/env bash
# Opt-in local checks; CI independently enforces the same lint command.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# Like Heartfull, respect core.hooksPath rather than changing it.
HOOKS_DIR="$(git rev-parse --git-path hooks)"
mkdir -p "$HOOKS_DIR"

# Pre-commit hook: catches lint errors before commit
cat > "$HOOKS_DIR/pre-commit" <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
echo "Running lint check before commit..."
pnpm lint
echo "All checks passed."
HOOK

chmod +x "$HOOKS_DIR/pre-commit"
echo "Installed pre-commit hook at $HOOKS_DIR/pre-commit"

# Pre-push hook: redundant safety check before push
cat > "$HOOKS_DIR/pre-push" <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
echo "Running lint check before push..."
pnpm lint
echo "All guard checks passed."
HOOK

chmod +x "$HOOKS_DIR/pre-push"
echo "Installed pre-push hook at $HOOKS_DIR/pre-push"
