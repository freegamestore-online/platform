# FreeGameStore — AI Agent Guide

Point your Claude Code, Codex, or any AI agent to this file for platform-aware development.

**Add to your CLAUDE.md or agent config:**
```
See https://freegamestore.online/skills.md for platform skills.
```

---

## Quick start — build a game with AI

```bash
# 1. Clone a template
gh repo clone freegamestore-online/template-game-canvas my-game
cd my-game

# 2. Replace placeholders
find . -type f \( -name "*.json" -o -name "*.tsx" -o -name "*.ts" -o -name "*.html" -o -name "*.md" -o -name "*.yaml" \) \
  -not -path "*/node_modules/*" -exec sed -i '' "s/APPNAME/my-game/g" {} \;

# 3. Install and run
pnpm install && pnpm dev
# Open http://localhost:5173

# 4. Build your game in web/src/App.tsx

# 5. Push to deploy
git push origin main
# → auto-deploys to my-game.freegamestore.online
```

Templates (10 engines, one repo each — always tracking the latest major):

| Template | Engine | What makes it different |
|---|---|---|
| `template-game-canvas` | Raw HTML5 Canvas 2D | No engine at all — you own the loop, rendering and physics. Most control. |
| `template-game-kaplay` | KAPLAY | Beginner-friendly verbs (`add`, `onCollide`) — fastest path to a playable 2D game. |
| `template-game-phaser` | Phaser 4 | The full-featured 2D engine: scenes, arcade physics, tilemaps, tweens, scaler. |
| `template-game-pixi` | Pixi.js v8 | Raw WebGL 2D scene graph — maximum rendering performance, bring your own game logic. |
| `template-game-excalibur` | Excalibur.js | TypeScript-native and actor-based — game objects are typed OOP classes with physics built in. |
| `template-game-littlejs` | LittleJS | Tiny all-in-one: particle system + procedural ZzFX sound built in — juicy games with zero asset files. |
| `template-game-3d` | Three.js + react-three-fiber | 3D as React components — scene graph in JSX, `useFrame` per-frame updates. |
| `template-game-babylon` | Babylon.js v9 | The full 3D engine: cameras, lights, materials, physics-ready meshes, WebGPU. |
| `template-game-grid` | React + CSS Grid | DOM, no canvas — turn-based boards (2048, chess, sudoku) with CSS transitions. |
| `template-game-cards` | React DOM card kit | Flippable cards, deck helpers, CSS 3D flip animations — card games without an engine. |

---

## MCP Server

The FreeGameStore MCP server lets an AI agent drive the **full game lifecycle from inside your editor** — not just read-only info. Endpoint: `https://mcp.freegamestore.online/mcp` (Streamable HTTP).

### Connect

**Claude Code:**
```bash
claude mcp add freegamestore -- npx mcp-remote https://mcp.freegamestore.online/mcp
```

**Cursor / any MCP client** (config form):
```json
{
  "mcpServers": {
    "freegamestore": {
      "command": "npx",
      "args": ["mcp-remote", "https://mcp.freegamestore.online/mcp"]
    }
  }
}
```

### Authentication

Read-only tools (`platform_guide`, `sdk_reference`, `deploy_status`, `game_info`, `game_logs`, `read_file`, `list_files`) work unauthenticated. Tools that **build, mutate, or list your games** need an FGS session token — the same one `fgs login` caches. Pass it as a bearer header through `mcp-remote`:

```bash
claude mcp add freegamestore -- \
  npx mcp-remote https://mcp.freegamestore.online/mcp \
  --header "Authorization: Bearer <token>"
```

### Two ways to build a game over MCP

The MCP supports both "I write the code" and "the platform writes the code":

1. **Your AI writes the code, MCP ships it.** Use `create_game` to provision + scaffold + deploy on any of the 10 engines (`kaplay`, `phaser`, `3d`, `pixi`, `babylon`, `excalibur`, `littlejs`, `canvas`, `grid`, `cards`), then `update_files` / `read_file` / `list_files` to iterate. You author every file; the MCP provisions and pushes (auto-redeploys in ~30-60s).
2. **You prompt, the platform's VibeCode agent writes + deploys it.** Use `agent_build` with a natural-language prompt — the server-side agent writes the code and deploys it for you, with engine-correct guidance for whichever template the game uses. By default it runs on the AI key saved for your account (the platform's encrypted key vault); if you have no saved key it falls back to the **free GitHub Models tier** (rate-limited) — so it works with zero setup. Pass `api_key` only to override. To work on an **existing** game, pass `game_id` — it imports the repo into the session first. Poll with `agent_status`.

| Tool | Signature | What it does |
|---|---|---|
| `create_game` | `(game_id, name, category, description?, template?)` | Provision + scaffold + deploy a new game on any engine. |
| `update_files` | `(game_id, files[], message?)` | Overwrite files in a game you own → auto-redeploys. |
| `read_file` / `list_files` | `(game_id, path?)` | Read / list a game's repo. |
| `agent_build` | `(prompt, game_id?, template?, api_key?, provider?, model?, session_id?)` | Hand the build to the VibeCode agent (`game_id` = work on an existing game; `template` = engine a new game seeds from). |
| `agent_status` | `(session_id)` | Poll an agent build. |
| `list_games` | `()` | Your published games. |
| `game_info` / `deploy_status` | `(game_id)` | Inspect a game. |
| `delete_game` / `discard_session` | `(game_id)` / `(session_id)` | Delete a live game / discard a draft. |
| `platform_guide` / `sdk_reference` | `(feature?)` | This guide / the games SDK. |

```
# Mode 1 — your AI writes it, MCP ships it
create_game(game_id="memory-match", name="Memory Match", category="puzzle",
            description="Flip cards to find pairs", template="cards")
update_files(game_id="memory-match",
             files=[{path:"web/src/App.tsx", content:"…"}], message="Add timer")

# Mode 2 — you prompt, the VibeCode agent writes + deploys it
agent_build(prompt="A neon snake game, deploy as neon-snake")   # uses your vault key
agent_build(prompt="A 3D marble maze, deploy as marble-maze", template="babylon")  # pick the engine
agent_status(session_id="…")            # poll until deployed
agent_build(prompt="Add a best-time display", game_id="neon-snake")  # iterate on an existing game
```

---

## Per-repo CLAUDE.md convention

Every game repo ships a minimal `CLAUDE.md`. Keep it slim — platform-wide rules live here in SKILLS.md, not in per-repo copies.

````markdown
# <name>

<one-line description>

- Subdomain: `<name>.freegamestore.online`
- Dev: `pnpm install && pnpm dev`
- Build: `pnpm build`
- Deploy: `git push origin main` (auto-deploys to R2 via GitHub Actions)

Free, MIT-licensed, no tracking. For platform conventions, read
https://freegamestore.online/skills.md
before writing or changing anything.
````

---

## IMPORTANT: What NOT to do

- **Do NOT ask for Cloudflare API tokens, keys, or secrets.** All infra is automated via GitHub Actions.
- **Do NOT provision manually** — no `wrangler pages project create`, no DNS, no CF API calls.
- **Do NOT deploy manually** — push to main = auto-deploy. No `wrangler pages deploy`.
- **Do NOT use feature branches** — trunk-based development. Push to main only.
- **Do NOT create staging environments** — there's only production. Fix forward.
- **Do NOT build custom topbars or shells** — use `@freegamestore/games` SDK components.
- **Do NOT add splash screens** — show the game field immediately on load.

---

## How deployment works

```
Push to main → GitHub Actions build → R2 → live at <game>.freegamestore.online
```

No manual deploy commands. Ever.

---

## Tech stack (required)

- TypeScript ^7, React ^19, Vite ^8, Tailwind CSS ^4, pnpm
- Node >=22
- Games SDK: `@freegamestore/games` (required for all games)
- 2D engines: raw Canvas, Pixi.js 8, Phaser, KAPLAY
- 3D engines: Three.js + react-three-fiber, or Babylon.js 7
- Linting: Biome

---

## Games SDK (`@freegamestore/games`)

**Every game MUST use the SDK components.** No custom topbars, no custom shells.

```bash
pnpm add @freegamestore/games
```

### GameShell — the root layout

Locks the game to `100svh`, prevents scroll, disables text selection.

```tsx
import { GameShell, GameTopbar } from '@freegamestore/games';

export default function App() {
  return (
    <GameShell topbar={<GameTopbar title="Chess" score={42} />}>
      {/* your game canvas / DOM */}
    </GameShell>
  );
}
```

### GameTopbar — the status bar

The **only** allowed topbar. Same font, padding, color tokens across every game.

```tsx
// Simple: just a score
<GameTopbar title="Tetris" score={42} />

// Custom stats
<GameTopbar
  title="Pac-Man"
  stats={[
    { label: 'Score', value: 1200, accent: true },
    { label: 'Lives', value: 3 },
    { label: 'Level', value: 5 },
  ]}
  actions={<GameButton size="sm" variant="ghost" onClick={pause}>Pause</GameButton>}
/>
```

### GameButton — touch-friendly buttons

Min 44px touch target. Three variants (`primary`, `secondary`, `ghost`), three sizes (`sm` 44px, `md` 48px, `lg` 56px).

### useLeaderboard — global leaderboard

```tsx
import { useLeaderboard, Leaderboard } from '@freegamestore/games';

function MyGame() {
  const { topScores, recentScores, submitScore, loading } = useLeaderboard('my-game');

  // Submit a score
  await submitScore(1500);

  // Render the leaderboard UI
  return <Leaderboard topScores={topScores} recentScores={recentScores} loading={loading} />;
}
```

### GameAuth — sign in with Google

```tsx
import { GameAuth } from '@freegamestore/games';

// Add to topbar actions slot
<GameTopbar title="My Game" actions={<GameAuth />} />
```

### useSound — muted by default

```tsx
import { useSound } from '@freegamestore/games';

function MyGame() {
  const { muted } = useSound();
  if (!muted) playSound(); // ALWAYS check before playing audio
}
```

### What NOT to do with the SDK

- Do NOT build custom Shell or topbar components
- Do NOT override `user-select`, `touch-action`, or `overflow` on root
- Do NOT pass custom colors to topbar or buttons — they use platform CSS tokens
- Do NOT play audio without checking `useSound().muted`

---

## No splash screens

Games must show the actual game field immediately on load.

- **Time-sensitive games** (Tetris, Snake): show game field with semi-transparent "Tap to play" overlay
- **Turn-based games** (Chess, Sudoku): start immediately, no overlay needed
- Game-over screens with "Play Again" are fine — they're after gameplay

---

## Project structure

```
game-name/
├── package.json           (root workspace)
├── pnpm-workspace.yaml
├── LICENSE                (MIT)
├── CLAUDE.md
├── .github/workflows/
│   ├── compliance.yml
│   └── ci.yml
└── web/
    ├── package.json       (@freegamestore/games in deps)
    ├── index.html
    ├── vite.config.ts
    ├── public/manifest.json
    └── src/
        ├── main.tsx
        ├── index.css      (Tailwind + brand CSS vars)
        └── App.tsx        (GameShell + your game)
```

---

## Mobile-first testing

FreeGameStore is a **mobile-first gaming platform**. Test on phone viewports first.

### Reference viewports

| Viewport | Device | Priority |
|----------|--------|----------|
| 320×568 | iPhone SE | **Critical** |
| 360×800 | Android | **Critical** |
| 393×852 | iPhone 15 | **Critical** |
| 568×320 | iPhone SE landscape | **Critical** |
| 667×375 | iPhone 8 landscape | **Critical** |

**Any scroll = fail.** The auditor tests every game across 12 viewports.

### Rules

- Game must fit viewport with **zero scroll** at every size from 320×568 up
- `html`, `body`, `#root`: `overflow: hidden`
- Use `100dvh` or `100svh` (not `100vh` — iOS Safari URL bar bug)
- Canvas/game area scales to available space, no fixed pixel sizes
- Buttons: minimum 44px touch target

Pre-publish check: `fgs screencheck`

---

## Brand design

- **Fonts**: Manrope (body) + Fraunces (display, 700-800)
- **Accent**: Emerald (#10b981)
- **CSS Variables**: `--paper`, `--ink`, `--muted`, `--line`, `--panel`, `--glass`, `--dock`, `--accent`
- **Dark mode**: `prefers-color-scheme: dark`
- **Layout**: GameShell + GameTopbar (fullscreen, no sidebar)

---

## Privacy rules

- ZERO analytics, tracking, cookies
- All user data in localStorage or via leaderboard API
- No third-party scripts except Google Fonts CDN

---

## Compliance checks (automated on push)

- `pnpm build` passes
- MIT `LICENSE` file exists
- No `.env.production` committed
- No tracking SDKs
- Brand fonts (Manrope + Fraunces) in `web/src/index.css`
- Brand CSS variables (`--paper`, `--ink`, `--accent`)
- HTML `lang`, `viewport`, `<title>` in `web/index.html`
- PWA `manifest.json`
- `freegamestore.online` link somewhere in `web/src/`
- Dark-mode support
- Largest JS asset under 300KB gzipped

---

## npm packages

| Package | What it does |
|---------|-------------|
| `@freegamestore/games` | React UI primitives (GameShell, GameTopbar, Leaderboard, auth, sounds) |
| `@freegamestore/cli` | CLI for scaffolding and publishing games |
| `@freegamestore/compliance` | Compliance checks (used by CLI and CI) |

**Never publish manually.** Version bump + push → OIDC publishes with provenance:

```bash
cd packages/games-sdk
npm version patch
git push --follow-tags
```

---

## Platform services

| Service | URL |
|---------|-----|
| Store | https://freegamestore.online |
| Publish portal | https://publish.freegamestore.online |
| Admin | https://admin.freegamestore.online |
| Agent (AI builder) | https://agent.freegamestore.online |
| Auth | https://auth.freegamestore.online |
| GitHub org | https://github.com/freegamestore-online |

---

## Support

| Need | Where |
|------|-------|
| Developer questions | [GitHub Discussions](https://github.com/freegamestore-online/freegamestore/discussions) |
| Bug reports | Issue on the game's GitHub repo |
| Creator applications | [Submissions](https://github.com/freegamestore-online/submissions/issues/new) |
| Platform docs | This file (SKILLS.md) |

All support is on GitHub. No email, Slack, or Discord.
