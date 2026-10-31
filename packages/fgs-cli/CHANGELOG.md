# @freegamestore/cli

## Unreleased

- Add `fgs migrate tailwind-tokens [--dir <path>] [--write]` (platform#397, epic #390). It rewrites long-hand `text-[var(--muted)]` utilities to token utilities (`text-muted`), keeping variants and opacity. It inlines retired aliases (`--surface`, `--border`, `--glass`, `--dock`) by the app's own definition, and reports a light/dark conflict instead of guessing (exit code 1). It renames `--error` to `--danger`, inserts the `@theme inline` block, and reports the unlayered rules, hex values and inline styles it cannot fix. Dry run by default and idempotent. `--bg` is left alone.

## 0.1.18

- Add 5 missing templates to `fgs init`: cards, kaplay, phaser, pixi, babylon (8 total).

## 0.1.0

- Initial release. Commands: `login`, `logout`, `whoami`, `init`, `publish`, `check`, `logs`, `doctor`, `list`, `screencheck`.
