---
title: Add sound to a game
description: The 30-second integration — useGameSounds(), 8 SFX, done.
---

The fastest path to audio in a FreeGameStore game.

## 1. The setup is already done

If you scaffolded with `npx fgs init`, your `App.tsx` already wraps your game
in `<GameShell>` and your topbar already shows the mute button. That's
everything the audio system needs.

## 2. Call useGameSounds from your game

```tsx
// web/src/components/Game.tsx
import { useGameSounds } from '@freegamestore/games';

export function Game() {
  const sounds = useGameSounds();

  function onPlayerMove() {
    sounds.playMove();
  }
  function onPointScored() {
    sounds.playScore();
  }
  function onLifeLost() {
    sounds.playError();
  }
  function onGameOver() {
    sounds.playGameOver();
  }
  // ...
}
```

That's it. The mute toggle in the topbar already controls everything.

## 3. Pick from the 8 sounds

| Function | When |
|---|---|
| `playMove` | Piece moves, card flips, button presses |
| `playScore` | Point scored, match found, correct answer |
| `playError` | Wrong answer, hit, lose a life |
| `playGameOver` | Game ends |
| `playLevelUp` | Beat a level, unlock an achievement |
| `playDrop` | Block lands, weight drops |
| `playClear` | Line clears, combo, sweep |
| `playTick` | Timer warning, countdown |

Full reference: [`useGameSounds`](/docs/sdk/use-game-sounds/).

## What you don't need to do

- **Wire mute state.** The topbar reads `useSound()`. `useGameSounds()` reads
  `useSound()`. Same state — toggling the icon mutes everything.
- **Defer audio context creation.** `useGameSounds` creates it lazily on the
  first non-muted call, so the browser's autoplay policy is satisfied (a
  user gesture has already happened — they tapped the unmute icon).
- **Ship audio files.** All 8 sounds are synthesized.

## When you need more than the 8

- A custom timbre? Use [`useSound`](/docs/sdk/use-sound/) and write your own
  oscillator inside a hook — mirror the structure of `useGameSounds.ts`.
- An actual audio sample (a voice clip, a snare drum)? Follow
  [Custom audio that respects mute](/docs/how-to/custom-audio/).
- Background music? Strongly discouraged. The catalog is muted-by-default
  and music auto-play would have to wait on user gesture anyway. If you
  really need it, gate it on `useSound().muted` like everything else, and
  expect the compliance check to scrutinize it.

## Common mistakes

- **Calling `useGameSounds()` in `App.tsx`** above `<GameShell>` — the
  returned functions silently no-op because they read a default-muted
  context. Call them from `<Game>` or anywhere inside the shell.
- **Bypassing `useGameSounds` and using `new Audio()` directly** — the
  compliance suite blocks this. See [why](/docs/how-to/custom-audio/).
