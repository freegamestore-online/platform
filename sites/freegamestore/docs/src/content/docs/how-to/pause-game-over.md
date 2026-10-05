---
title: Pause + game-over flow
description: Two states every interactive game needs. The SDK provides the controls; you provide the logic.
---

Real-time games (Tetris, Snake, Pac-Man, anything with a tick) need a
pause button and a game-over screen. The SDK gives you both surfaces —
you wire the state.

## Pause

`<GameTopbar>` has two props for interactive games:

```ts
onPlayPause?: () => void;
paused?: boolean;
```

Set them and the topbar renders a play/pause icon next to the score.
Tapping the icon calls `onPlayPause`. The `paused` prop controls whether
the icon shows ▶ or ❚❚.

```tsx
import { useState } from 'react';
import { GameShell, GameTopbar } from '@freegamestore/games';

export function App() {
  const [paused, setPaused] = useState(false);

  return (
    <GameShell
      topbar={
        <GameTopbar
          score={42}
          onPlayPause={() => setPaused(p => !p)}
          paused={paused}
          onRestart={() => /* reset */}
        />
      }
    >
      <Game paused={paused} />
    </GameShell>
  );
}
```

Pass `paused` into your game loop:

```tsx
function Game({ paused }: { paused: boolean }) {
  useEffect(() => {
    if (paused) return;          // ← skip the loop
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [paused]);
}
```

When the player taps the pause icon, your interval clears. When they tap
again, it resumes — your game logic doesn't know paused exists.

## Pause UI overlay (optional)

A blank screen while paused is fine. If you want a "Paused" overlay:

```tsx
{paused && (
  <div style={{
    position: 'absolute', inset: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: 'white', fontSize: '2rem',
  }}>
    Paused
  </div>
)}
```

Inside the children slot of `<GameShell>`. Position absolute → it overlays
the canvas.

## Game over

Game over is just a state in your game. Render a full-screen overlay
inside the play area with the final score and the action buttons:

```tsx
import { GameButton, useLeaderboard } from '@freegamestore/games';

function GameOver({ score, onRestart }: { score: number; onRestart(): void }) {
  const { submitScore } = useLeaderboard('my-game');

  useEffect(() => {
    submitScore(score);   // fire-and-forget
  }, []);

  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: 'var(--paper)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: '1rem', padding: '2rem',
    }}>
      <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: '2rem' }}>Game over</h2>
      <div style={{ fontSize: '3rem', fontFamily: 'Fraunces, serif' }}>{score}</div>
      <GameButton size="lg" onClick={onRestart}>Play again</GameButton>
    </div>
  );
}
```

`submitScore` resolves before the player taps "Play again" in 99% of cases.
The hook auto-refreshes its `topScores` and `recentScores` after a
successful submit, so if you also render `<Leaderboard>` on this screen,
the new entry shows up automatically.

## Restart from the topbar

`onRestart` on `<GameTopbar>` adds a restart icon next to play/pause. Wire
it to the same function as your "Play again" button:

```tsx
<GameTopbar
  score={score}
  onPlayPause={togglePause}
  paused={paused}
  onRestart={reset}
/>
```

This is what makes the topbar feel native — restart is one tap away
mid-game, not buried in a settings menu.

## Combining with audio

Match the moment to the sound:

```tsx
const sounds = useGameSounds();

function reset() {
  // no sound — restarts shouldn't be loud
  initGameState();
}

function onLifeLost() {
  sounds.playError();
}

function onFinalGameOver() {
  sounds.playGameOver();
  setShowOverlay(true);
}
```

## Related

- [`<GameTopbar>`](/docs/sdk/game-topbar/) — the play/pause + restart props.
- [`<GameButton>`](/docs/sdk/game-button/) — for "Play again".
- [`useLeaderboard`](/docs/sdk/use-leaderboard/) — submit + refresh on game-over.
- [`useGameSounds`](/docs/sdk/use-game-sounds/) — `playGameOver`, `playError`.
