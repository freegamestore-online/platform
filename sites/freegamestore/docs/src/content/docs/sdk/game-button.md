---
title: GameButton
description: The brand-matched button. Three variants, three sizes, all touch-friendly.
---

`<GameButton>` is the prescribed in-game button — for Start, Restart, "Play
again", menus. It matches the topbar's typography and accent color, so a
button you drop into your play area doesn't look bolted on.

## Signature

```ts
interface GameButtonProps {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost';  // default: 'primary'
  size?: 'sm' | 'md' | 'lg';                     // default: 'md'
  onClick?: () => void;
  disabled?: boolean;
  block?: boolean;                               // full width
}
```

## Variants

- **`primary`** — accent-color fill on white text. Use for the main action
  (Start, Play again, Submit score).
- **`secondary`** — panel-color fill with a thin border. Use for the
  alternative (Restart, Back to menu).
- **`ghost`** — transparent. Use for tertiary links (Cancel, Skip).

## Sizes

All sizes meet the 44px iOS touch-target minimum.

| Size | min-height | Font | Use case |
|---|---|---|---|
| `sm` | 2.75rem (44px) | 0.85rem | In dense UIs — list rows, inline. |
| `md` | 3rem (48px)    | 0.9rem  | Default — game-over screen, menus. |
| `lg` | 3.5rem (56px)  | 1rem    | The hero "Start" button. |

## Example: game-over screen

```tsx
import { GameButton } from '@freegamestore/games';

function GameOver({ onRestart, onMenu }: { onRestart(): void; onMenu(): void }) {
  return (
    <div className="flex flex-col gap-3 items-center">
      <GameButton size="lg" onClick={onRestart}>
        Play again
      </GameButton>
      <GameButton variant="ghost" onClick={onMenu}>
        Back to menu
      </GameButton>
    </div>
  );
}
```

## What you get for free

- 96% scale-down on `pointerdown` — tactile press feedback.
- `touch-action: manipulation` — no 300ms tap delay on mobile Safari.
- `WebkitTapHighlightColor: transparent` — no blue flash on tap.
- Manrope 700 font matching the topbar.

## Constraints

- **No custom variants.** Three variants is the contract. If you find
  yourself wanting "danger red", the action is probably in the wrong place
  (the topbar's Restart icon already handles destructive intent).
- **Use brand fonts.** The button uses `--accent` and Manrope automatically.
  Don't pass inline styles overriding them — the compliance check on font
  loading will flag stylesheets that drift.

## Related

- [Brand tokens](/docs/reference/brand-tokens/) — the CSS variables this reads.
