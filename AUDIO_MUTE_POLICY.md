# Audio mute policy

**Status**: Active (enforced 2026-05-19)
**Owner**: Platform
**Compliance check**: `checkAudioMuteRespect` in `packages/compliance`

## The rule

> Any game that produces sound from the page **must** respect the platform
> mute toggle exposed by `@freegamestore/games`.

In practice, that means a game's source must reference one of:

- `useGameSounds()` — synthesized SFX with mute-handling built in. The 90% path.
- `useSound()` — exposes `{ muted, toggle }` so a game can gate its own custom audio.

If a game produces sound via raw browser APIs (`new AudioContext()`,
`webkitAudioContext`, `new Audio()`, an `<audio>` element, or kaplay's
`loadSound()`) without importing either of those hooks, the check fails
and the build is rejected.

## What this is **not**

This policy does **not** ban custom audio. Game-specific sounds are part of
the genre — bowling pins crashing, simon's tone row, an arcade shooter's
weapon fire. Those should keep their custom Web Audio code. They just need
one extra import and a `muted` gate so the topbar Mute button still works.

## Why

The topbar Mute button in `GameTopbar` is the only audio control on the
platform. Users learn it once. A game that ignores it is user-hostile in
exactly the moment users most need it to work — late at night, on
mobile, in a quiet room.

Two games (`bowling`, `simon`) shipped with custom Web Audio that ignored
the toggle. Both were silently broken from the user's perspective. The
fix per game is two lines of React; the cost of letting it drift further
is one user-trust loss per release.

## Decision rationale

Three alternatives considered:

1. **Ban all non-SDK audio.** Rejected. Bowling's pin clatter and simon's
   tone row are genre essentials; forcing them into the generic SDK palette
   would make those games worse, not better.

2. **Warn-only audit, no hard gate.** Rejected. Warnings get ignored. The
   user impact of muted-button-doing-nothing is severe enough to justify
   blocking the merge.

3. **Hard gate, both ways out.** Adopted. Easy mode (`useGameSounds`) for
   games that don't care, escape hatch (`useSound`) for games that do.
   Two lines of integration either way.

## Implementation

- **Check**: `packages/compliance/src/checks/audio-mute-respect.ts`
- **Wired into**: `runChecksOn()` in `packages/compliance/src/index.ts`
- **Surfaces in**: `fgs check` CLI command, the compliance audit Worker,
  per-game GitHub Actions workflows that call the SDK

## Adding to a per-game workflow

The check runs automatically through the central compliance package. To
also fail at the per-game GitHub Actions level (recommended for any game
that produces sound), add a step to that game's
`.github/workflows/compliance.yml`:

```yaml
- name: Audio respects mute toggle
  run: |
    if grep -rqE "new AudioContext\(|webkitAudioContext|new Audio\(|<audio[ >]|\.loadSound\(" web/src/; then
      if ! grep -rqE "useGameSounds|useSound" web/src/; then
        echo "ERROR: game produces sound but does not respect the platform mute toggle"
        echo "Fix: import useGameSounds or useSound from @freegamestore/games"
        exit 1
      fi
    fi
```

## See also

- `useGameSounds.d.ts` in the SDK — 8 synthesized SFX functions
- `SoundContext.d.ts` in the SDK — `{ muted, toggle }` hook
- `GameShell.tsx` — wraps children in `SoundProvider`, so any descendant
  component can call `useSound()` without extra setup
