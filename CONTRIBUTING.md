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

Following Heartfull's pattern, this installs a fast pre-push hook that runs
`pnpm lint` (Biome). It respects `core.hooksPath`; rerun the installer after
changing that setting. The installer replaces the pre-push hook at that path,
so preserve any existing custom hook first.

Hooks are never installed automatically on clone or dependency installation.
Use `git push --no-verify` for a one-off bypass, or remove the installed
`pre-push` file to opt out. CI independently runs the same lint command on every
PR and main push; hooks are a local convenience, not a safety dependency.
