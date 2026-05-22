# @freegamestore/games

Shared React UI primitives for games on **freegamestore.online**. Brand-consistent layout, scroll-free viewport lock, touch-friendly controls, and synthesized sound effects.

**Version:** 0.14.0

## Installation

```bash
npm i @freegamestore/games
# or
pnpm add @freegamestore/games
```

Peer dependency: React 19+.

## Quick Start

```tsx
import { GameShell, GameTopbar } from '@freegamestore/games'

export default function App() {
  return (
    <GameShell topbar={<GameTopbar title="Chess" score={42} />}>
      {/* your game canvas / DOM */}
    </GameShell>
  )
}
```

## Components

### GameShell

Root layout wrapper. Locks the game to `100svh`, prevents document scroll, disables text selection and touch callout. Every game wraps its content in this.

```tsx
<GameShell topbar={<GameTopbar title="Tetris" score={42} />}>
  <MyGame />
</GameShell>
```

| Prop | Type | Description |
|------|------|-------------|
| `topbar` | `ReactNode?` | Topbar element (typically `<GameTopbar />`) |
| `children` | `ReactNode` | Game content — fills remaining viewport |

### GameTopbar

The single allowed topbar. Same font, padding, and color tokens across every game.

```tsx
// Simple: just a score
<GameTopbar title="Tetris" score={42} />

// Custom stats + play/pause controls
<GameTopbar
  title="Pac-Man"
  stats={[
    { label: 'Score', value: 1200, accent: true },
    { label: 'Lives', value: 3 },
    { label: 'Level', value: 5 },
  ]}
  rules={<p>Eat all the dots. Avoid ghosts.</p>}
  onPlayPause={togglePause}
  paused={isPaused}
  onRestart={restart}
/>
```

| Prop | Type | Description |
|------|------|-------------|
| `title` | `string?` | Game name, left side |
| `score` | `number?` | Convenience for single-score games |
| `stats` | `GameTopbarStat[]?` | Custom stat lineup (replaces `score`) |
| `actions` | `ReactNode?` | Right-side buttons (max 2) |
| `rules` | `ReactNode?` | Game instructions — shows info icon, opens overlay on tap |
| `onPlayPause` | `() => void?` | Renders play/pause icon button |
| `paused` | `boolean?` | Controls play/pause icon state |
| `onRestart` | `() => void?` | Renders restart icon button |

### GameAuth

Sign-in / avatar widget for the topbar `actions` slot. Shows "Sign in" when signed out, avatar + dropdown when signed in.

```tsx
<GameTopbar title="Chess" score={42} actions={<GameAuth />} />
```

No props — uses `useAuth` internally.

### GameButton

Touch-friendly button. Min 44px touch target. Four variants, three sizes.

```tsx
<GameButton variant="primary" size="lg" onClick={start}>Play Again</GameButton>
<GameButton variant="secondary" size="sm" onClick={undo}>Undo</GameButton>
<GameButton variant="ghost" size="sm" onClick={flip}>Flip</GameButton>
<GameButton variant="danger" onClick={quit}>Quit</GameButton>
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | (required) | Button content |
| `variant` | `'primary' \| 'secondary' \| 'ghost' \| 'danger'` | `'primary'` | Visual style |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Touch-target size |
| `onClick` | `() => void?` | | Click handler |
| `disabled` | `boolean?` | `false` | Disabled state |
| `block` | `boolean?` | `false` | Full width |

Sizes: `sm` (44px), `md` (48px), `lg` (56px).

### GameModal

Fullscreen modal overlay. Closes on backdrop click or Escape.

```tsx
<GameModal open={showSettings} onClose={() => setShowSettings(false)} title="Settings">
  <p>Game settings here</p>
</GameModal>
```

| Prop | Type | Description |
|------|------|-------------|
| `open` | `boolean` | Whether the modal is visible |
| `onClose` | `() => void` | Called on backdrop click or Escape |
| `title` | `string?` | Header text |
| `children` | `ReactNode` | Modal content |

### GameOverScreen

Standard game-over overlay with score, high score, and play again button.

```tsx
<GameOverScreen
  score={1200}
  highScore={1500}
  onPlayAgain={restart}
>
  <Leaderboard {...leaderboard} />
</GameOverScreen>
```

| Prop | Type | Description |
|------|------|-------------|
| `score` | `number` | Final score |
| `highScore` | `number?` | Personal best (shows "New high score!" when beaten) |
| `onPlayAgain` | `() => void` | Play again handler |
| `children` | `ReactNode?` | Extra content below the score |

### GameConfirm

Confirm/cancel dialog built on GameModal.

```tsx
<GameConfirm
  open={showQuit}
  title="Quit Game?"
  message="Your progress will be lost."
  onConfirm={quit}
  onCancel={() => setShowQuit(false)}
  variant="danger"
/>
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `open` | `boolean` | | Whether visible |
| `title` | `string` | | Dialog title |
| `message` | `string` | | Body text |
| `onConfirm` | `() => void` | | Confirm handler |
| `onCancel` | `() => void` | | Cancel handler |
| `confirmLabel` | `string?` | `'Confirm'` | Confirm button text |
| `cancelLabel` | `string?` | `'Cancel'` | Cancel button text |
| `variant` | `'default' \| 'danger'` | `'default'` | Confirm button style |

### GameThemeToggle

Compact sun/moon theme toggle (28px). Cycles system/light/dark. Designed for the topbar `actions` slot.

```tsx
<GameTopbar title="Chess" actions={<><GameThemeToggle /><GameTextSizeToggle /></>} />
```

No props.

### GameTextSizeToggle

Compact text-size toggle (28px). Cycles default/large/small. Shows A/A+/A-. Designed for the topbar `actions` slot.

```tsx
<GameTopbar title="Chess" actions={<GameTextSizeToggle />} />
```

No props.

### Leaderboard

Tabbed leaderboard display (Top / Recent). Use with the `useLeaderboard` hook.

```tsx
const { topScores, recentScores, loading } = useLeaderboard('chess')

<Leaderboard topScores={topScores} recentScores={recentScores} loading={loading} />
```

| Prop | Type | Description |
|------|------|-------------|
| `topScores` | `LeaderboardEntry[]` | All-time top scores |
| `recentScores` | `LeaderboardEntry[]` | Recent scores |
| `loading` | `boolean` | Loading state |

## Hooks

### useAuth

Auth state for FreeGameStore (Google OAuth via `auth.freegamestore.online`).

```tsx
const { user, loading, signIn, signOut } = useAuth()
```

Returns `{ user: User | null, loading: boolean, signIn: () => void, signOut: () => void }`.

### useLeaderboard

Fetch and submit scores to the platform leaderboard.

```tsx
const { topScores, recentScores, submitScore, loading, refresh } = useLeaderboard('tetris')

// Submit a score
const { ok, rank } = await submitScore(1200)
```

### useGameSounds

Synthesized sound effects via Web Audio API. Zero audio files. All sounds auto-respect the mute toggle.

```tsx
const { playMove, playScore, playError, playGameOver, playLevelUp, playDrop, playClear, playTick } = useGameSounds()

// Play a sound (no-op when muted)
playScore()
```

| Sound | Use case |
|-------|----------|
| `playMove` | Piece moved, card flipped, button pressed |
| `playScore` | Scored a point, matched, correct answer |
| `playError` | Wrong answer, hit obstacle, lost life |
| `playGameOver` | Game over — descending tones |
| `playLevelUp` | Level up / achievement — ascending arpeggio |
| `playDrop` | Hard drop / thud |
| `playClear` | Line clear / combo |
| `playTick` | Countdown tick / timer warning |

### useSound

Low-level mute state from the SDK's SoundProvider. Games should check `muted` before playing any custom audio.

```tsx
const { muted, toggle } = useSound()
if (!muted) myCustomAudio.play()
```

## Exports

```
@freegamestore/games → GameShell, GameTopbar, GameAuth, GameButton, GameModal,
                        GameOverScreen, GameConfirm, GameThemeToggle,
                        GameTextSizeToggle, Leaderboard, useAuth, useLeaderboard,
                        useGameSounds, useSound
```

## License

MIT
