---
title: GameTopbar
description: The brand-matched topbar. Score, rules, pause, restart, mute, auth — all in one component.
---

`<GameTopbar>` is the prescribed topbar for every FreeGameStore game.
Same fonts, same icons, same touch targets, same color tokens across the
whole catalog. Mount it in `<GameShell>`'s `topbar` prop.

## Signature

```ts
interface GameTopbarProps {
  title?: string;
  score?: number;                  // shorthand for stats=[{ Score, accent: true }]
  stats?: GameTopbarStat[];        // for games with lives / level / time
  actions?: ReactNode;             // right-side slot — put <GameAuth /> here
  rules?: ReactNode;               // adds an ℹ button → fullscreen "How to Play"
  onPlayPause?: () => void;        // renders play/pause toggle
  paused?: boolean;                // controls icon when onPlayPause is set
  onRestart?: () => void;          // renders restart icon
}

interface GameTopbarStat {
  label: string;     // short uppercase, e.g. "Lives"
  value: ReactNode;
  accent?: boolean;  // flips value to the accent color
}
```

## What the topbar always shows

Left-aligned:
- A **home icon** linking back to `freegamestore.online`. Brand surface — non-removable.
- An **ℹ rules icon** if you passed `rules`.
- Your `title` if provided.

Right-aligned:
- Your stats (`score` or `stats`).
- Optional play/pause + restart icons.
- The **mute toggle** — always present. Wired to [`useSound()`](/docs/sdk/use-sound/).
- Your `actions` slot (typically `<GameAuth />`).

## Single-score game

```tsx
<GameTopbar title="Snake" score={42} actions={<GameAuth />} />
```

## Multi-stat game

```tsx
<GameTopbar
  title="Tetris"
  stats={[
    { label: 'Score', value: score, accent: true },
    { label: 'Lines', value: lines },
    { label: 'Level', value: level },
  ]}
  onPlayPause={() => setPaused(p => !p)}
  paused={paused}
  onRestart={reset}
  actions={<GameAuth />}
/>
```

## Adding rules

```tsx
<GameTopbar
  score={score}
  rules={
    <>
      <p>Use the arrow keys to move.</p>
      <p>Catch all the gems before time runs out.</p>
    </>
  }
/>
```

The ℹ button opens a fullscreen overlay with your content. Closes on the ×
icon. No need to manage modal state.

## Constraints

- **Keep `actions` short.** ≤2 buttons. The topbar is brand surface, not a
  settings page. Big config menus belong inside the play area.
- **Don't replace the mute toggle.** It's always rendered and always reads the
  platform `useSound()` state. The compliance check
  [`audio-mute-respect`](/docs/compliance/checks/) fails any game that adds
  a parallel mute toggle.

## Related

- [`<GameShell>`](/docs/sdk/game-shell/) — where you mount this.
- [`<GameAuth>`](/docs/sdk/game-auth/) — drop into `actions`.
- [`useSound`](/docs/sdk/use-sound/) — what the mute button toggles.
