# @freegamestore/games

## 0.19.0

Styling migration to Tailwind 4 on the platform tokens (platform#393, epic #390, ADR-001).

**Breaking: a game that upgrades must compile the SDK's classes.** Add the
`@source` line, the token `@theme inline` block and
`@import "@freegamestore/games/theme.css"` to `index.css`; see "Styling" in the
README. Without them the components render unstyled. The `template-game-*`
repos already carry the token mapping.

- Rewrite `GameShell`, `GameModal`, `GameConfirm`, `GameButton`, `GameAuth`, `GameOverScreen`,
  `Leaderboard`, `GameResultScreen`, `StartScreen`, `Confetti`, `ScorePopup`, `GameThemeToggle`
  and `GameTextSizeToggle` with Tailwind utilities on the tokens. No static inline styles remain;
  the dynamic ones (confetti piece positions, score-popup coordinates, stagger indexes) are
  marked `// Dynamic: …`.
- Remove the injected `<style>` blocks. **Removed exports:** `CONFETTI_CSS`, `SCORE_POP_CSS`,
  `RESULT_SCREEN_CSS`, `START_SCREEN_CSS`. `GAME_TOKENS_CSS` is unchanged.
- Add `@freegamestore/games/theme.css`: the `animate-fgs-*` animations and keyframes, plus
  `accent-ink`, `accent-soft` and the `fgs` radius and text sizes.
- Floating UI sits on the opaque `bg-panel` surface; only scrims are translucent.
- `GameButton`: the press feedback is `active:scale-[0.96]` (it no longer mutates `style`),
  and the danger variant uses the `danger` token.
- The result, start and confetti hooks are `data-fgs="…"` attributes. The `fgs-*` class names
  are gone.
- `Confetti` colours the last piece with `--danger` instead of `--error`.
- Add `src/styling.test.ts` (fails on a CSS string, `<style>`, runtime stylesheet injection, or
  an uncommented/static/indirect `style`) and `src/theme.test.ts` (theme.css matches the
  components).
