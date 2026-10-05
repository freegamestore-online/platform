---
title: GameShell
description: The required wrapper. Locks layout, mounts the SoundProvider, draws the storefront footer.
---

`<GameShell>` is the one component every FreeGameStore game must use. It:

- Locks the page to `100svh × 100vw` — your game cannot accidentally
  introduce body scroll.
- Mounts the `SoundProvider` that [`useSound()`](/docs/sdk/use-sound/) and
  [`useGameSounds()`](/docs/sdk/use-game-sounds/) read. Audio hooks called
  *outside* GameShell silently no-op (see [the gotcha](/docs/how-to/custom-audio/)).
- Renders an iOS-safe footer with a link back to the storefront.
- Disables text selection, long-press menus, and 300ms tap delay.

## Signature

```ts
interface GameShellProps {
  topbar?: ReactNode;
  children: ReactNode;
}
```

`topbar` is optional but conventional — pass [`<GameTopbar>`](/docs/sdk/game-topbar/).

## Layout contract

```
┌─────────────────────────────────────────┐
│ topbar (fixed height, opt-in)           │
├─────────────────────────────────────────┤
│                                         │
│ children — flex: 1, min-height: 0,      │
│            overflow: hidden             │
│                                         │
├─────────────────────────────────────────┤
│ safe-area + storefront footer link      │
└─────────────────────────────────────────┘
  100svh tall, 100vw wide, fixed inset 0
```

Your game's root element gets the whole middle row. Sized correctly: don't
add `min-height: 100vh` or `overflow: auto` to anything inside — that fights
the contract.

## Why 100svh, not 100vh

On iOS Safari, `100vh` includes the *retracted* URL bar height. When the URL
bar shows again, your `100vh` element overflows the visible area and the
page scrolls. `100svh` (small viewport units) stays equal to the visible
viewport regardless of bar state — no scroll artifacts.

## Minimal usage

```tsx
import { GameShell, GameTopbar } from '@freegamestore/games';

export function App() {
  return (
    <GameShell topbar={<GameTopbar title="My Game" score={0} />}>
      <Game />
    </GameShell>
  );
}
```

`<Game />` here can be a canvas, a grid of cells, a Babylon scene — anything.
GameShell only cares that it fits in the box.

## What you can't do

- **Render two GameShells.** They're not designed to nest. One per app.
- **Use `useSound()` above it.** Hooks called by a parent of GameShell get the
  default-muted state that never updates — your audio will never play.
- **Stack a custom footer.** The storefront link is mandatory brand surface;
  the compliance check verifies it ships.

## Related

- [`<GameTopbar>`](/docs/sdk/game-topbar/) — the topbar you mount in the `topbar` prop.
- [`useSound`](/docs/sdk/use-sound/) — the state GameShell provides.
- [`useGameSounds`](/docs/sdk/use-game-sounds/) — synthesized SFX wired into the provider.
