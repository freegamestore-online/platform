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
