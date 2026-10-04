# Contributing to FreeGameStore Platform

## Setup

```bash
pnpm install
```

## Development

```bash
pnpm -r build      # Build all packages
pnpm -r typecheck   # Type-check all packages
pnpm lint           # Lint with Biome
pnpm -r test        # Run all tests
```

## Packages

- `games-sdk` — UI components + hooks for FGS games
- `fgs-cli` — CLI for publishing and managing games
- `compliance` — Automated compliance checks for store submissions

## Code style

Enforced by [Biome](https://biomejs.dev/). Run `pnpm lint` before committing.

## Optional local git hooks

After installing dependencies, opt in with:

```sh
bash scripts/install-hooks.sh
```

Following Heartfull's pattern, this installs two optional git hooks:

- **pre-commit**: Runs `pnpm lint` (Biome) before each commit, catching lint
  errors locally before they're committed.
- **pre-push**: Runs `pnpm lint` before push as a redundant safety check.

Both hooks respect `core.hooksPath`; rerun the installer after changing that
setting. The installer replaces hooks at that path, so preserve any existing
custom hooks first.

Hooks are never installed automatically on clone or dependency installation.
To bypass hooks for a single operation:
- `git commit --no-verify` to bypass pre-commit
- `git push --no-verify` to bypass pre-push

Remove the installed hook files to opt out entirely. CI independently runs the
same lint command on every PR and main push; hooks are a local convenience, not
a safety dependency.
