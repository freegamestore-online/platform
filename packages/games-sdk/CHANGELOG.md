# @freegamestore/games

## Unreleased (next: 0.20.0)

Drop-in for games on 0.19.x; no code changes are needed.

- **`useAuth().signOut` works with auth's logout CSRF check (#486).** Auth now refuses a
  background `POST /logout` from a game, since any game could otherwise sign the player out
  silently. `signOut` submits a top-level form POST instead, which auth accepts only as a
  user-activated navigation, so call it from a click handler. Auth redirects back to the game,
  which loads signed out. On 0.19.x, `signOut` reloads the page but the player stays signed in.
- **Leaderboard reads work in the browser again (#409).** `useLeaderboard` fetched the public
  top and recent boards with `credentials: 'include'`, but the leaderboard worker answers public
  reads without `Access-Control-Allow-Credentials`, so the browser discarded every response and
  the boards were always empty. The reads are now credential-less; the sign-in handoff and the
  bearer-token submit are unchanged.
- **Leaderboard exports restored (zap-drills#6).** `Leaderboard`, `useLeaderboard`,
  `LeaderboardEntry`, `LeaderboardProps` and `UseLeaderboardOptions` are exported again. They
  were hidden in 0.18.0 (#31), which broke the build of games that already used them.
- **`useSound()` / `useGameSounds()` follow the mute toggle anywhere (#410).** The mute state is
  page-wide, so a hook called in `App`, above `<GameShell>`, now unmutes with the topbar speaker
  instead of staying muted forever. Calling it outside `<GameShell>` logs a one-time
  `console.warn` in Vite dev builds. Games that carry the `AudioBridge` workaround keep working.
- **`GameTopbar` fits a 320px screen (#414).** Up to 480px wide, the icon buttons narrow to
  1.75rem (still 44px tall), spacing tightens, and stats show only their value (the label stays
  for screen readers). The title truncates with an ellipsis but keeps at least 2.5rem. Stats
  that do not fit drop out whole, so Sign in and the other controls stay on screen. Checked in
  Chromium at 320, 360 and 390px with a Tetris-style bar (title, rules, three stats,
  pause, restart, Sign in).

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
