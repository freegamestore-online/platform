---
title: 'CLI: fgs check'
description: Run the same compliance suite locally that CI runs in PRs.
---

The `@freegamestore/cli` package runs the same compliance suite locally
that CI runs on every push. Use it before opening a PR — fixing
compliance issues in your terminal is a lot faster than fixing them in
CI logs.

## Run it

From your game's root (the directory with `web/` in it):

```bash
npx -y @freegamestore/cli@latest check
```

That'll:

1. Verify `web/dist` is built (and build it if not).
2. Run every check in [the full list](/docs/compliance/checks/).
3. Print pass/fail for each, with actionable hints on failures.
4. Exit non-zero if any check failed.

No install step — the `-y` flag accepts the auto-install prompt, and
pinning `@latest` ensures you always run the current rules.

## Common invocations

### Just check, don't build

```bash
npx -y @freegamestore/cli@latest check --skip-build
```

For when you've already built and just want to re-run rules.

### Filter to one check

```bash
npx -y @freegamestore/cli@latest check --only bundle-size
```

For iterating on a single failure.

### From inside `web/`

The CLI walks up looking for the game root. You can run it from anywhere
inside your repo.

## Example output

```
✓ brand-fonts                  Manrope + Fraunces detected
✓ brand-tokens                 5 tokens present
✓ no-tracking                  no known trackers
✓ license-mit                  LICENSE matches MIT
✗ bundle-size                  348 KB > 300 KB budget
  → Drop unused deps, or declare a 3D engine to lift the cap to 600 KB.
✗ audio-mute-respect           web/dist/index.js: new Audio() without useSound() gate
  → See https://freegamestore.online/docs/how-to/custom-audio/

2 of 18 checks failed.
```

## Scaffolding

The same CLI also scaffolds new games:

```bash
npx -y @freegamestore/cli@latest init my-game
```

That produces a working template at `./my-game/` with the brand shell, the
SDK pre-wired, a stub `<Game />`, and CI workflows. Pick a template with
`--template canvas | grid | 3d` (default: `canvas`).

## All commands

```bash
npx -y @freegamestore/cli@latest --help
```

| Command | What it does |
|---|---|
| `init <game-id>` | Scaffold a new game from a template. |
| `check` | Run compliance against the current game directory. |
| `publish` | Auto-provision repo + R2 hosting + DNS for this game, or open a submission Issue. |
| `login` / `logout` / `whoami` | Manage the CLI's session with the platform. |
| `doctor` | Local health check (signed in, API reachable, tools installed). |
| `list` | List games you've published. |
| `logs` | Tail the GitHub Actions deploy logs for one of your games. |
| `screencheck` | Visual / layout regression check (screenshot diff). |

## When to update

The CLI is published from the platform monorepo. New rules get added; old
rules get refined. **Always run `@latest`** — pinning to a specific version
means you'd miss new compliance gates and find out in the storefront
re-audit instead of in your terminal.

## Related

- [Why we audit](/docs/compliance/why/)
- [All checks](/docs/compliance/checks/)
