# SDK Visual Refresh – Before/After Showcase

Showcase for issue [#211](https://github.com/freegamestore-online/platform/issues/211), part of epic [#195](https://github.com/freegamestore-online/platform/issues/195).

> **Status: representative mockups, not live screenshots.**
> The SDK pieces listed below are built and released to the repo: #205 (StartScreen), #206 (GameResultScreen), #207 (feel kit), #208 (GameTopbar CSS module and motion tokens), and #209 (design tokens). The template update (#210) is still open, and no game has adopted the refreshed SDK yet. The "after" panels show what the SDK provides once a game adopts it. They are not captures of the games. The live screenshots will replace them when the games adopt the SDK.

Each mockup is an inline SVG labelled "Representative mockup – SDK visual refresh" in [`index.html`](index.html).

## What changed in the SDK

| Area | Issue | Before | After |
|---|---|---|---|
| Topbar | #208 | Inline styles and an injected `<style>` block | A CSS module with the same layout, colour tones as classes, and `:active` / `:focus-visible` in the module |
| Motion | #208, #209 | Hard-coded durations per component | `--motion-duration` and `--motion-easing` tokens, zeroed under `prefers-reduced-motion` |
| Tokens | #209 | Brand colours defined only in each game's own CSS | One source in `tokens.ts`, exported as `GAME_TOKENS_CSS` for games to inject |
| Start screen | #205 | Each game built its own start screen | `StartScreen`: artwork, title, tagline, Play, and How to play |
| Game result | #206 | Static `GameOverScreen` with a score | `GameResultScreen`: an animated win or lose card with stats, a badge, and a focused action; confetti on a win |
| Feel kit | #207 | Each game wrote its own particles, shake and haptics | `@freegamestore/games/feel`: `useParticles`, `useShake`, `useHaptics`, `ScorePopup`, and tween and easing helpers, all tree-shakeable |

## Mosaic Rush (the pilot)

Mosaic Rush built the first versions of these pieces (its start screen, its animated result overlays, its tile particles and its feel helpers), and they were extracted into the SDK. The game itself still runs on its own copies until it adopts the SDK.

### Before
- Topbar styled with inline styles; no shared stylesheet.
- Level-cleared and game-over shown as a plain status line with a button.
- Tile matches have no feedback beyond the tile changing.

### After
- Shared `GameTopbar` CSS module, with the token-driven colours and press feedback.
- `StartScreen` with the mosaic artwork, the title, and How to play.
- `GameResultScreen` with the level stats and a focused "Next level" action, plus confetti on a win.
- `ScorePopup` for each cleared group, and `useParticles` for the match burst.

## Sort Puzzle

Sort Puzzle is a standalone game on the `grid` template. It has not adopted the refreshed SDK yet.

### Before
- Default SDK topbar with inline styles.
- A static game-over card when the tube run is lost.
- No start screen; the first board starts immediately.

### After
- Topbar with the motion tokens and the CSS module.
- `StartScreen` as the entry point, with how-to-play.
- `GameResultScreen` for a solved sort, with the move count and time.
- `useShake` on an illegal pour and `useHaptics` on the win.

## Snake (classic)

Snake is the classic game in the showcase. It was chosen because it is the most established game in the registry. Its registry entry is `snake`, named "Snake", category `brain-training`.

### Before
- Static game-over card with the score and a play-again button.
- Score shown in the topbar with no feedback when food is eaten.

### After
- `GameResultScreen` with the score, the best score, and an animated entrance.
- `ScorePopup` on each food eaten, and `useParticles` for the burst.
- Topbar with the motion tokens, and dark and light themes from the token set.

## Not included

- No live screenshots. This needs a browser run against adopted games, which waits on #210 and the game adoption.
- No change to `sites/freegamestore/`. The site has no showcase or gallery page to link from, and the storefront is generated from the registry.
