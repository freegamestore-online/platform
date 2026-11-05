# Changelog

All notable changes to the platform packages are documented here. The format is
loosely based on [Keep a Changelog](https://keepachangelog.com/). Packages are
versioned independently; releases publish via `.github/workflows/publish.yml`
(version-bump triggered, OIDC trusted publishing).

## [Unreleased]

### Fixed
- `@freegamestore/games` (next: 0.20.0): credential-less leaderboard reads (#409), leaderboard
  exports restored (zap-drills#6), page-wide mute state with a dev warning outside
  `<GameShell>` (#410), `GameTopbar` fits 320px (#414). See
  `packages/games-sdk/CHANGELOG.md`.
- `@freegamestore/compliance` (next: 0.11.1): `no-brand-overrides` accepts
  `Noto Sans Symbols` and `Noto Sans Symbols 2`, next to the other symbol and emoji fonts,
  so a game can bundle a subset for blocks such as Mahjong Tiles (#415). Games consume it
  through `@freegamestore/cli`, which pins an exact compliance version, so it needs a CLI
  release too.
- `@freegamestore/cli`: dropped `new Function(...)` in `screencheck` (flagged as
  eval-injection) in favor of a string expression passed to `page.evaluate`.
- `@freegamestore/cli`: renamed the doctor-local `CheckResult`/`CheckStatus` to
  `DoctorCheckResult`/`DoctorCheckStatus` to remove the export-name collision
  with `@freegamestore/compliance`.
- `@freegamestore/games`: marked fire-and-forget fetches in `useAuth` /
  `useLeaderboard` with `void` to signal intentional non-await.

## compliance 0.8.2 / cli 0.2.3 — 2026-06-04

### Added
- CI now runs `pnpm -r test`; `compliance` and `cli` gained `test` scripts +
  vitest so their suites (previously orphaned) gate platform merges.

### Fixed
- `checkHtmlMeta` now requires the viewport meta to disable pinch/double-tap
  zoom (`user-scalable=no` or `maximum-scale=1`), not merely exist.
- Restored 15 checks that commit `35cc189` accidentally dropped from
  `runChecksOn` (back to the full 38-check suite); CI had been red since.

## compliance 0.8.1 and earlier

See git history. Compliance was vendored from FAS in `c0ab0ab` and grown to its
current check set across subsequent releases.
