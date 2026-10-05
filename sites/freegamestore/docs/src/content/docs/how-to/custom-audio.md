---
title: Custom audio that respects mute
description: The pattern for shipping your own sounds without failing compliance.
---

The 8 sounds from [`useGameSounds()`](/docs/sdk/use-game-sounds/) cover
80% of games. The other 20% need a specific snare, a voice clip, or a
guitar strum — sounds that can't be synthesized from one oscillator.

Custom audio is allowed. It just has to play by the same rule everything
else does: **gate every sound source behind `useSound().muted`.**

## The compliance check

`audio-mute-respect` (in the platform compliance suite) scans your bundle
for raw audio APIs:

```ts
/\bnew\s+AudioContext\(|\bwebkitAudioContext\b|\bnew\s+Audio\(|<audio[\s>]|\.loadSound\(/
```

If it finds one *without* a nearby `useSound()` or `muted` check, your
build fails. The check is intentionally loose — false positives are
preferable to a game that pings at you with no kill switch.

## The pattern (App.tsx-only games)

For games where you don't have a sub-component (e.g. Snake done in one
file), you can't directly call `useSound()` from the same component that
defines `<GameShell>` — the hook returns the default-muted context.

The fix: a tiny **AudioBridge** component that lives *inside* GameShell,
reads the live state, and writes it into a ref.

```tsx
// App.tsx
import { useRef } from 'react';
import { GameShell, GameTopbar, useSound } from '@freegamestore/games';

function AudioBridge({ apiRef }: { apiRef: React.MutableRefObject<{ muted: boolean }> }) {
  const sound = useSound();
  apiRef.current.muted = sound.muted;
  return null;
}

export function App() {
  const audioRef = useRef({ muted: true });

  function playSnareSample() {
    if (audioRef.current.muted) return;
    const audio = new Audio('/snare.wav');
    audio.play().catch(() => { /* user hasn't tapped yet */ });
  }

  return (
    <GameShell topbar={<GameTopbar score={0} />}>
      <AudioBridge apiRef={audioRef} />
      <Game playSnare={playSnareSample} />
    </GameShell>
  );
}
```

That's the whole pattern. `audioRef.current.muted` is always current
because `AudioBridge` re-renders on every toggle and overwrites the ref.

## The pattern (multi-component games)

If you have a `<Game>` component below `<GameShell>`, just call `useSound()`
there:

```tsx
// Game.tsx
import { useSound } from '@freegamestore/games';

export function Game() {
  const { muted } = useSound();

  function playSnare() {
    if (muted) return;
    const a = new Audio('/snare.wav');
    a.play().catch(() => {});
  }
  // ...
}
```

Simpler. No ref bridge needed.

## Why hooks above GameShell don't work

`useSound()` reads a React context. `GameShell` mounts the `SoundProvider`
*inside* itself. A component that's a parent of `<GameShell>` is outside
the provider — `useContext(SoundContext)` returns the default value
(`{ muted: true, toggle: () => {} }`) which never updates.

This catches everyone exactly once. If your audio "never plays," check
that you're calling `useSound()` from a child of `<GameShell>`, not a
sibling.

## Shipping the audio file

Custom samples have to be in your bundle, not a CDN:

- Add `.wav` / `.mp3` / `.ogg` to `web/public/`.
- Reference with a relative path: `new Audio('/snare.wav')`.
- The compliance check `no-tracking` blocks any external audio URL — no
  loading from `https://cdn.example.com/sounds/...`.

## Sizes

Audio files count against your bundle budget (300 KB, or 600 KB for 3D
games). Keep custom samples small:

- 22 kHz mono `.mp3` is usually 4-12 KB per short sound.
- 44 kHz stereo is overkill for a game beep.

## Related

- [`useSound`](/docs/sdk/use-sound/) — what you gate on.
- [`useGameSounds`](/docs/sdk/use-game-sounds/) — try this first.
- [All checks](/docs/compliance/checks/) — including `audio-mute-respect`.
