---
title: Build your first game
description: From zero to a deployed game in about 10 minutes.
---

## Prerequisites

- Node 22+
- pnpm 10+
- A GitHub account
- The `fgs` CLI: `npx -y @freegamestore/cli@latest --help`

## 1. Scaffold

```bash
npx -y @freegamestore/cli@latest init my-game
cd my-game/web
pnpm install
pnpm dev
```

That opens a working game template at `http://localhost:5173/`. It already has
the brand shell, dark-mode support, and a stub `<Game />` you'll replace.

The default template is `canvas` (2D engine). Other options: `--template grid`
(turn-based + cells) or `--template 3d` (Babylon).

## 2. Make it your game

Open `web/src/components/Game.tsx`. The default looks like:

```tsx
import { useEffect, useRef } from 'react';

interface GameProps {
  onScore: (n: number) => void;
  onGameOver: () => void;
}

export function Game({ onScore, onGameOver }: GameProps) {
  // your game logic here
  return <canvas /* or any JSX */ />;
}
```

`App.tsx` wraps it in [`<GameShell>`](/docs/sdk/game-shell/) and a
[`<GameTopbar>`](/docs/sdk/game-topbar/) that displays a score, a Sign-in
button via [`<GameAuth>`](/docs/sdk/game-auth/), and the mute toggle. None
of that is yours to wire — the SDK does it.

## 3. Add sound

Inside your `Game` component (which is a child of `GameShell` — *required*
for the audio context, see [the gotcha](/docs/how-to/custom-audio/)):

```tsx
import { useGameSounds } from '@freegamestore/games';

export function Game({ onScore, onGameOver }: GameProps) {
  const sounds = useGameSounds();

  function handleAction() {
    sounds.playMove();   // short tick
    onScore(score + 1);
  }
  function handleWin() {
    sounds.playLevelUp();
  }
  // ...
}
```

The topbar Mute button already controls audibility. You don't need to wire
mute state — the SDK does that too. Full list of sounds:
[`useGameSounds`](/docs/sdk/use-game-sounds/).

## 4. Submit scores

```tsx
import { useLeaderboard } from '@freegamestore/games';

const { submitScore } = useLeaderboard('my-game');
// after game over:
await submitScore(finalScore);
```

Sign-in is handled by [`<GameAuth>`](/docs/sdk/game-auth/) in the topbar.

## 5. Ship it

```bash
git init && git add . && git commit -m "first game"
npx -y @freegamestore/cli@latest publish
```

`publish` runs compliance, then either auto-provisions your repo +
R2 hosting + `my-game.freegamestore.online` DNS, or — if
auto-provision isn't available — opens a prefilled GitHub Issue for the
platform team to review.

Full publish flow: [Publish to the storefront](/docs/start/publishing/).
