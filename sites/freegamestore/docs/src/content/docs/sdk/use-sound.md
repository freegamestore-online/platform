---
title: useSound()
description: Read the platform mute state. The contract every audio source must respect.
---

`useSound()` reads the platform mute state — the same state the
`<GameTopbar>`'s mute icon toggles. **Every audio source in your game must
gate itself behind `useSound().muted`.** That's the rule.

If you only ever play sound via [`useGameSounds()`](/docs/sdk/use-game-sounds/),
you don't need `useSound()` directly — `useGameSounds` already respects it.
You only reach for `useSound()` when you ship your own audio (e.g. an
external `.mp3`).

## Signature

```ts
function useSound(): {
  muted: boolean;
  toggle: () => void;
}
```

## The contract

```tsx
import { useSound } from '@freegamestore/games';

function MyOscillator() {
  const { muted } = useSound();
  // ...
  function playBeep() {
    if (muted) return;   // ← this line, or your game fails compliance
    // ... actually play
  }
}
```

The compliance check [`audio-mute-respect`](/docs/compliance/checks/)
scans your bundle for raw audio APIs — `new AudioContext()`, `new Audio()`,
`<audio>` elements, kaplay's `loadSound`, etc. — and fails the build if it
finds one *without* a `muted` check nearby.

## Why default-muted?

A muted-by-default game is the only safe default for a curated catalog:

- Auto-playing audio violates browsers' autoplay policies and prints a
  console warning the user can't dismiss.
- A storefront full of games that blast at you when their tab opens is a
  hostile experience.
- A first-tap gesture is the natural unlock — the user *chose* to play, so
  they can also choose to unmute. The platform mute icon is right there.

`<GameShell>` mounts the provider with `muted: true`. The icon flips it.
That's the whole flow.

## Where you can call it

Inside `<GameShell>`. If you call it from a parent (above GameShell), you
get a disconnected default context that's permanently muted and never
updates — your audio will *never* play and you'll burn an evening
debugging it. The pattern is documented in
[Custom audio that respects mute](/docs/how-to/custom-audio/).

## Toggling programmatically

```tsx
const { muted, toggle } = useSound();
return <button onClick={toggle}>{muted ? 'Unmute' : 'Mute'}</button>;
```

You almost never need this — the topbar already does it. But it's useful
for a "play sound" splash that toggles before starting the game.

## Related

- [`useGameSounds`](/docs/sdk/use-game-sounds/) — synthesized SFX that already respect this.
- [`<GameShell>`](/docs/sdk/game-shell/) — mounts the provider this hook reads.
- [Custom audio that respects mute](/docs/how-to/custom-audio/) — the pattern for shipping your own sounds.
