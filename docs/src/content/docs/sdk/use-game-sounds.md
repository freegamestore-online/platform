---
title: useGameSounds()
description: Eight synthesized SFX functions, mute-aware, zero audio files.
---

`useGameSounds()` returns 8 ready-made sound effects synthesized via the Web
Audio API. No `.mp3` files to ship, no decoding latency, no licensing — the
sounds are generated from oscillators on demand. All 8 functions already
read [`useSound()`](/docs/sdk/use-sound/) — when the platform mute is on,
they no-op.

## Signature

```ts
function useGameSounds(): {
  playMove: () => void;
  playScore: () => void;
  playError: () => void;
  playGameOver: () => void;
  playLevelUp: () => void;
  playDrop: () => void;
  playClear: () => void;
  playTick: () => void;
}
```

## The 8 sounds

| Function | What it sounds like | Use for |
|---|---|---|
| `playMove()` | Short tick (square, 600 Hz, 60 ms) | Piece moved, card flipped, button pressed |
| `playScore()` | Two-tone ding (sine, 880 → 1100 Hz) | Scored a point, matched, correct answer |
| `playError()` | Low buzz (sawtooth, 200 Hz, 200 ms) | Wrong answer, hit obstacle, lost life |
| `playGameOver()` | Three descending tones (440 → 350 → 260) | End of run |
| `playLevelUp()` | Ascending C-E-G-C arpeggio | Level up, achievement, big win |
| `playDrop()` | Triangle thud (150 Hz, 120 ms) | Tetris piece landing, bowling release |
| `playClear()` | Three ascending tones (700 → 900 → 1200) | Line clear, combo, sweep |
| `playTick()` | Sharp tick (square, 1000 Hz, 30 ms) | Timer warning, countdown |

## Minimal usage

```tsx
import { useGameSounds } from '@freegamestore/games';

function Game() {
  const sounds = useGameSounds();

  function onMove() {
    sounds.playMove();
    // ... game logic
  }
  function onCorrect() {
    sounds.playScore();
  }
  function onWrong() {
    sounds.playError();
  }
  // ...
}
```

That's the entire integration. The topbar mute toggle already controls
audibility — you don't pass it `muted`, you don't add a separate mute
button.

## Where you can call it

Inside `<GameShell>`. See [the gotcha](/docs/how-to/custom-audio/).

## Performance

- The `AudioContext` is created lazily on first non-muted call, then reused.
- Each sound spins up one `OscillatorNode` + one `GainNode`, runs for the
  prescribed duration, and is garbage-collected. No long-lived audio
  graphs.
- All 8 are mapped to short-duration tones (≤300 ms). Safe to call from a
  tight game loop — but rate-limit yourself in code if your game can fire
  the same sound 60× per second.

## When you need more

- **Background music:** not provided. The catalog is muted-by-default and
  music auto-play is hostile; we deliberately don't ship a music API. If
  you really need music, follow [Custom audio that respects mute](/docs/how-to/custom-audio/).
- **Custom timbre:** if `playScore` doesn't fit your game's voice, write
  your own oscillator using `useSound` to gate it (same pattern as
  `useGameSounds` — see the source).
- **Real audio files:** allowed, but they have to ship in your bundle (no
  CDN tracking) and they have to gate on `useSound().muted`. See the
  custom-audio guide.

## Related

- [`useSound`](/docs/sdk/use-sound/) — the mute state these functions read.
- [`<GameTopbar>`](/docs/sdk/game-topbar/) — has the mute toggle.
- [Add sound to a game](/docs/how-to/audio/) — full walkthrough.
