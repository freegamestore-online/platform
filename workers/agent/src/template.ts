/** Template files and system prompts — parameterized by store config. */

import { GAME_DEPLOY_WORKFLOW } from "@freegamestore/compliance";
import type { StoreConfig } from "./config";

// ── Shared template files (identical for apps and games) ──

const SHARED_FILES: Record<string, string> = {
  "pnpm-workspace.yaml": `packages:\n  - web\n`,

  "package.json": `{
  "name": "APPNAME",
  "private": true,
  "packageManager": "pnpm@10.30.3",
  "engines": { "node": ">=22" },
  "pnpm": { "onlyBuiltDependencies": ["esbuild"] },
  "scripts": {
    "dev": "pnpm --filter @APPNAME/web dev",
    "build": "pnpm --filter @APPNAME/web build",
    "preview": "pnpm --filter @APPNAME/web preview",
    "typecheck": "pnpm --filter @APPNAME/web exec tsc -b",
    "test": "pnpm --filter @APPNAME/web test"
  }
}`,

  "web/package.json": `{
  "name": "@APPNAME/web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^19",
    "react-dom": "^19"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.1",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "@vitejs/plugin-react": "^4.3",
    "tailwindcss": "^4.1",
    "typescript": "^5.7",
    "vite": "^6"
  }
}`,

  "web/vite.config.ts": `/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
});`,

  "web/tsconfig.json": `{
  "files": [],
  "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.node.json" }]
}`,

  "web/tsconfig.app.json": `{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true
  },
  "include": ["src"]
}`,

  "web/tsconfig.node.json": `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true
  },
  "include": ["vite.config.ts"]
}`,

  "web/src/main.tsx": `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);`,

  ".gitignore": `node_modules\ndist\n.DS_Store\n*.local\n`,
};

// ── Games-specific template files ──

const GAME_FILES: Record<string, string> = {
  "web/index.html": `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Fraunces:opsz,wght@9..144,700;9..144,800&display=swap" rel="stylesheet" />
    <link rel="manifest" href="/manifest.json" />
    <meta name="theme-color" content="#10b981" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <title>APPNAME — FreeGameStore</title>
    <!-- Platform analytics loader. CF Web Analytics is auto-provisioned at publish;
         GA4 and Plausible are opt-in in the game's Analytics panel in the Studio. -->
    <script src="https://api.freegamestore.online/v1/analytics.js?app=APPNAME" defer></script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`,

  "web/public/manifest.json": `{
  "name": "APPNAME",
  "short_name": "APPNAME",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0f0f0f",
  "theme_color": "#10b981",
  "orientation": "any"
}`,

  "web/src/index.css": `@import "tailwindcss";

:root {
  --bg: #0f0f0f;
  --surface: #1a1a1a;
  --ink: #f0f0f0;
  --muted: #999;
  --accent: #10b981;
  --border: #2a2a2a;
  --success: #22c55e;
  --warning: #fbbf24;
  --error: #ef4444;
  font-family: "Manrope", system-ui, sans-serif;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  overflow: hidden;
}

#root {
  width: 100vw;
  height: 100dvh;
  overflow: hidden;
}`,

  "web/src/components/GameShell.tsx": `import type { ReactNode } from "react";

interface GameShellProps {
  title: string;
  children: ReactNode;
}

/** GameShell: full-viewport wrapper with a 44px top bar and game canvas area.
 *  The topbar shows the game name and a link to FreeGameStore.
 *  The children fill the remaining viewport height. */
export function GameShell({ title, children }: GameShellProps) {
  return (
    <div style={{ width: "100vw", height: "100dvh", display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg)" }}>
      <header style={{ height: 44, minHeight: 44, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 1rem", background: "var(--surface)", borderBottom: "1px solid var(--border)", fontSize: "0.85rem" }}>
        <span style={{ fontWeight: 700, fontFamily: "Fraunces, serif" }}>{title}</span>
        <a href="https://freegamestore.online" target="_blank" rel="noopener noreferrer" style={{ color: "var(--muted)", fontSize: "0.75rem", textDecoration: "none" }}>
          FreeGameStore
        </a>
      </header>
      <main style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        {children}
      </main>
    </div>
  );
}`,

  "web/src/App.tsx": `import { GameShell } from "./components/GameShell";

export default function App() {
  return (
    <GameShell title="APPNAME">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", flexDirection: "column", gap: "1rem" }}>
        <h1 style={{ fontFamily: "Fraunces, serif", fontSize: "2rem", margin: 0 }}>
          APPNAME
        </h1>
        <p style={{ color: "var(--muted)" }}>
          Your game will appear here once it&rsquo;s built.
        </p>
      </div>
    </GameShell>
  );
}`,

  LICENSE: `MIT License

Copyright (c) 2025 FreeGameStore

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`,
};

// ── Public API ──

/** Path B deploy workflow: on push to main, gate on compliance, build web/dist,
 *  and sync it to R2 at <r2Prefix>/<repo>/ — the prefix the host Worker serves.
 *  Uses --no-frozen-lockfile: the agent authors package.json with no committed
 *  lockfile, and AI edits change deps, so a frozen install would break the whole
 *  fleet's deploys. Org secrets R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_ACCOUNT_ID
 *  are set once on the org. */
export function getTemplateFiles(_config: StoreConfig): Record<string, string> {
  const base = { ...SHARED_FILES, ...GAME_FILES };
  // All repos use the shared deploy workflow from @freegamestore/compliance (#111).
  // It calls the ci-workflows pipeline which handles compliance checks, version stamp, smoke test.
  base[".github/workflows/deploy.yml"] = GAME_DEPLOY_WORKFLOW;
  return base;
}

/** The engine a game is built on. The three headline engines a creator can
 *  "build on" are kaplay / phaser / r3f; canvas (no engine) and the DOM-based
 *  grid/cards starters fall back to the canvas guide. Detected from the loaded
 *  project's web/package.json so the agent always gets engine-correct authoring
 *  guidance regardless of which template the game was generated from. */
export type GameEngine = "canvas" | "kaplay" | "phaser" | "r3f" | "pixi" | "babylon" | "excalibur" | "littlejs" | "grid" | "cards";

/** Public engine keys (as used by the publisher picker + MCP create_game) →
 *  template repo a fresh session seeds from. "3d" is the public key for the
 *  internal "r3f" engine. Vendored from admin's TEMPLATE_REPOS — keep in sync. */
export const ENGINE_TEMPLATE_REPOS: Record<string, string> = {
  canvas: "template-game-canvas",
  grid: "template-game-grid",
  cards: "template-game-cards",
  kaplay: "template-game-kaplay",
  phaser: "template-game-phaser",
  "3d": "template-game-3d",
  pixi: "template-game-pixi",
  babylon: "template-game-babylon",
  excalibur: "template-game-excalibur",
  littlejs: "template-game-littlejs",
};

/** Infer the engine from the loaded project's web/package.json dependencies.
 *  Defaults to "canvas" when there's no engine dep (or the file is missing /
 *  unparseable). */
export function detectEngine(files: Map<string, string>): GameEngine {
  const raw = files.get("web/package.json");
  if (!raw) return "canvas";
  try {
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps["phaser"]) return "phaser";
    if (deps["kaplay"]) return "kaplay";
    if (deps["@react-three/fiber"]) return "r3f";
    if (deps["pixi.js"]) return "pixi";
    if (deps["@babylonjs/core"]) return "babylon";
    if (deps["excalibur"]) return "excalibur";
    if (deps["littlejsengine"]) return "littlejs";
    if (deps["three"]) return "r3f";
  } catch {
    return "canvas";
  }
  // grid/cards have no engine dep — recognize them by their template kit files.
  if (files.has("web/src/hooks/useGrid.ts")) return "grid";
  if (files.has("web/src/lib/deck.ts") || files.has("web/src/components/CardGrid.tsx")) return "cards";
  return "canvas";
}

/** Per-engine authoring guide, injected into the game system prompt in place of
 *  a single canvas-only description. Each tells the model the engine's real
 *  template shape + how to build on it, so it doesn't reach for the wrong APIs
 *  (e.g. useGameLoop/lib/canvas on a KAPLAY game, or hand-rolled physics on
 *  Phaser). */
const ENGINE_GUIDES: Record<GameEngine, string> = {
  canvas: `## Your engine: raw HTML5 Canvas 2D + React
This game has NO game-engine dependency — you own the loop, rendering and physics on a <canvas>, using the template's helpers. Most control, most code: keep files small and split logic out.

The template (already loaded — read it first with read_file / list_files):
- web/src/App.tsx — your entry point. It imports from the SDK:
  import { GameShell, GameTopbar, GameAuth } from "@freegamestore/games";
  GameShell = root full-viewport layout (a 'topbar' prop + the game area as children); GameTopbar = title + score bar; GameAuth = optional sign-in.
- web/src/hooks/ — reusable local hooks, USE THESE, don't reinvent:
  - useControls(): { keys, mouse:{x,y,down}, touch:{x,y,active} } — keyboard+mouse+touch, ref-based (no re-renders).
  - useGameLoop(cb:(dt:number)=>void, paused?): requestAnimationFrame loop, dt in seconds, capped at 100ms. Use this for the loop — never setInterval.
  - useHighScore(key): [highScore, updateIfHigher] — localStorage-backed.
- web/src/lib/canvas.ts — 2D canvas helpers: drawGlow, drawText, hexToRgba, lerp, clamp, dist, angleTo, randomInRange, randomColor.
- web/src/types.ts (shared types), web/src/index.css (CSS vars, fullscreen no-scroll).
Build primarily in App.tsx + new files under web/src/. Keep update (logic) separate from draw (render). Genre fits: platformers/shooters/physics = canvas loop + lib/canvas; grid/puzzle/board = CSS grid + a 2D array (no canvas needed); cards = flexbox + tap/drag.`,

  kaplay: `## Your engine: KAPLAY (2D)
This game runs on KAPLAY (the maintained Kaboom.js successor) — a small 2D engine that OWNS the game loop, rendering, input, gravity and collisions. You write game logic as verbs, not a render loop.

The template (already loaded — read it first with read_file / list_files):
- web/src/game.ts — THE GAME. It exports startGame(canvas, onScore) => teardown and KAPLAY drives everything here. This is where you build.
- web/src/App.tsx — thin React shell: GameShell + GameTopbar from "@freegamestore/games", a <canvas> handed to startGame, and score state updated through the onScore callback. You rarely touch it.
- web/src/hooks/useHighScore.ts, web/src/types.ts, web/src/index.css.
How to build in game.ts (the context is \`k\`, created with global:false — call methods on \`k\`):
- Import the engine directly: \`import kaplay from "kaplay"\`. Do NOT import \`@freegamestore/games/kaplay\`; that SDK export does not exist.
- For helper functions, type the context as \`type K = ReturnType<typeof kaplay>\`; avoid \`k: any\` because it hides bad engine calls until browser smoke.
- Entities: k.add([ k.pos(x,y), k.rect()/k.circle()/k.sprite(), k.area() (collision), k.body() (gravity), k.color(), "tag" ]).
- Stick to supported primitives: k.rect, k.circle, k.sprite, k.text. Do NOT invent \`k.poly\`; it is not available in the installed KAPLAY version.
- k.text() parses \`[name]…[/name]\` as STYLED-TEXT MARKUP. Never put a bare square bracket in a text string: \`k.text("[G] Gummies  [C] Chocolates")\` throws "Styled text error: unclosed tags G,C" at runtime even though the build passes. Write labels without brackets ("G - Gummies"), close the tag (\`[red]Score[/red]\`), or escape it (\`\\\\[G]\`).
- Input: k.onKeyDown/onKeyPress, k.onMouseMove/onMousePress, k.onTouchStart.
- Collisions: entity.onCollide("tag", (other) => …).
- Scenes: k.scene("play", () => …) then k.go("play") / k.go("over", score).
- Per-frame: k.onUpdate(() => …); movement via k.move(dir, speed) or setting .pos.
- Report the score to React via the onScore callback passed into startGame.
Do NOT use useGameLoop or lib/canvas — KAPLAY replaces them; don't hand-roll a rAF loop or physics. Split large games into web/src/scenes/*.ts and web/src/entities/*.ts and import them into game.ts.`,

  phaser: `## Your engine: Phaser 4 (2D)
This game runs on Phaser 4 — the most widely-used HTML5 game engine. It OWNS the loop through the Scene lifecycle and gives you arcade physics, groups, tweens, input and a responsive scaler. Build with scenes, never a hand-rolled loop.

The template (already loaded — read it first with read_file / list_files):
- web/src/game.ts — THE GAME. It exports startGame(parent, onScore) => teardown and creates a Phaser.Game with a PlayScene. This is where you build.
- web/src/App.tsx — thin React shell: GameShell + GameTopbar, a <div> that Phaser fills with its own <canvas>, and score updated through the onScore callback. You rarely touch it.
- web/src/hooks/useHighScore.ts, web/src/types.ts, web/src/index.css.
How to build in game.ts:
- A game is one or more Phaser.Scene subclasses with preload(), create(), update(). Add scenes (MenuScene, LevelScene) and pass them in the scene array for bigger games.
- Objects: this.add.rectangle/circle/text/sprite(...). Give physics with this.physics.add.existing(obj), then drive (obj.body as Phaser.Physics.Arcade.Body) — setVelocity/setImmovable/setCircle/setAllowGravity.
- Groups + collisions: this.physics.add.group(); this.physics.add.overlap(a,b,cb) / this.physics.add.collider(a,b,cb).
- Input: this.input.on("pointermove"/"pointerdown", …); this.input.keyboard?.createCursorKeys().
- Timing: this.time.addEvent({ delay, loop, callback }); tweens via this.tweens.add({...}).
- Design against the fixed virtual VW×VH (Scale.FIT letterboxes to the device). Report the score via the onScore callback.
Phaser 4 API notes (differs from the v3 you may know): setTintFill() is gone — use setTint(color).setTintMode(Phaser.TintModes.FILL); FX/preFX/postFX and BitmapMask are replaced by the unified filters system (obj.filters.internal.addMask(...) / Phaser.Actions.AddEffectBloom()); Geom.Point is gone — use Math.Vector2; Mesh/Plane game objects are removed. Standard sprites/shapes/text/arcade physics are unchanged.
Phaser is pre-installed and split into its own vendor chunk — do NOT add other heavy libs and do NOT use useGameLoop. Split large games into web/src/scenes/*.ts and import them.`,

  r3f: `## Your engine: Three.js + react-three-fiber (3D)
This game is 3D, built with react-three-fiber (the React renderer for Three.js) plus drei helpers. You compose the scene as React components; useFrame drives per-frame updates.

The template (already loaded — read it first with read_file / list_files):
- web/src/App.tsx — GameShell + GameTopbar from "@freegamestore/games" wrapping a <Canvas> from "@react-three/fiber".
- web/src/components/Game.tsx — the 3D scene (meshes, lights, camera, the useFrame loop). Build here.
- web/src/lib/logic.ts (+ logic.test.ts — keep testable logic here), web/src/hooks/useHighScore.ts, web/src/types.ts, web/src/index.css.
How to build:
- Scene graph as JSX: <mesh>, <boxGeometry/>, <meshStandardMaterial/>, <ambientLight/>, <directionalLight/>. Camera/controls via @react-three/drei (OrbitControls, Text, etc.).
- Per-frame: useFrame((state, dt) => …) — animate refs here; never setInterval.
- Keep pure game logic (scoring, collision math you compute) in web/src/lib/ so it's unit-testable; keep rendering in components.
- three + @react-three/fiber + drei are pre-installed and split into a vendor chunk. Do NOT hand-edit web/package.json to change 3D deps (breaks the frozen lockfile).
Split large scenes into web/src/components/*.tsx.`,
  pixi: `## Your engine: Pixi.js v8 (WebGL 2D)
This game renders with Pixi.js v8 — a high-performance WebGL 2D scene graph. The template mounts a Pixi Application into a container div inside a local Shell component (web/src/components/Shell.tsx — NOT the SDK GameShell).
Structure:
- web/src/App.tsx — creates \`new Application()\`, \`await app.init({ resizeTo: container })\`, appends app.canvas, builds the stage, drives the game with \`app.ticker.add((t) => ...)\`. Clean up in the effect return (destroy the app; guard against init racing unmount — the template shows the pattern).
- Draw with Graphics (\`new Graphics().rect(...).fill(color)\`, .circle, .poly), Text, Container. position/rotation/scale/alpha on any display object.
- Input: \`obj.eventMode = "static"\`; obj.on("pointerdown", ...); or listen on app.stage globally.
- pixi.js v8 API ONLY (init is async; Graphics chains shape().fill() — NOT beginFill, that's v7). Do not add npm deps (frozen lockfile).`,
  babylon: `## Your engine: Babylon.js v9 (3D)
This game renders with Babylon.js — a full 3D engine. The template creates an Engine + Scene on a canvas inside a local Shell component (web/src/components/Shell.tsx — NOT the SDK GameShell).
Structure:
- web/src/App.tsx — \`new BABYLON.Engine(canvas, true)\`, \`new BABYLON.Scene(engine)\`, camera (ArcRotateCamera or FreeCamera), HemisphericLight, meshes via \`BABYLON.MeshBuilder.Create*\`, \`engine.runRenderLoop(() => scene.render())\`, engine.resize on window resize, dispose in cleanup.
- Materials: StandardMaterial with diffuseColor (Color3). Animate in \`scene.onBeforeRenderObservable.add(...)\` or registerBeforeRender.
- Input: \`scene.onPointerObservable\` / ActionManager on meshes; keyboard via scene.onKeyboardObservable.
- @babylonjs/core + gui + loaders are pre-installed. Import from "@babylonjs/core" (namespace or named). Do not add npm deps (frozen lockfile).`,
  excalibur: `## Your engine: Excalibur.js (TypeScript-native 2D)
This game runs on Excalibur — an actor-based 2D engine where game objects are typed OOP classes. The engine owns the loop, physics and input; you subclass Actor instead of writing a render loop. The template mounts the Engine on a canvas inside a local Shell component (web/src/components/Shell.tsx — NOT the SDK GameShell).
Structure:
- web/src/App.tsx — \`new Engine({ canvasElement, displayMode: DisplayMode.FillContainer })\`, add actors/scenes, \`game.start()\`, \`game.dispose()\` in cleanup.
- Game objects: \`class Player extends Actor { onInitialize(engine) {...} onPreUpdate(engine, delta) {...} }\` — pos/vel/rotation/graphics/collision are built-in typed properties (\`vec(x, y)\`, \`Color.fromHex(...)\`).
- Collisions: set \`actor.body.collisionType = CollisionType.Active/Fixed/Passive\`; react with \`actor.on("collisionstart", (evt) => ...)\`.
- Input: \`engine.input.pointers.primary.on("move"/"down", ...)\`; \`engine.input.keyboard.isHeld(Keys.Left)\`, \`.wasPressed(Keys.Space)\`. There is NO top-level \`Input\` export — do NOT \`import { Input }\`; input is only reached through \`engine.input\`. Import \`Keys\` for key constants.
- Collisions: enable with \`actor.body.collisionType = CollisionType.Active\` (or Fixed/Passive), then \`actor.on("collisionstart", (evt) => { ... })\`. IMPORTANT: \`evt.other\` is a **Collider**, not the actor — get the actor with \`evt.other.owner\` and narrow with instanceof: \`if (evt.other.owner instanceof Asteroid) { ... }\`. Comparing \`evt.other\` directly to an Actor is a type error.
- Text/labels: use the \`Label\` game object — \`new Label({ text: "Score: 0", pos: vec(x, y), color: Color.White, font: new Font({ size: 24, family: "Manrope", textAlign: TextAlign.Center }) })\`, then \`scene.add(label)\` and update \`label.text\`. There is NO \`graphics.useText()\` — for a graphic use \`actor.graphics.use(new Text({ text, font }))\`. \`TextAlign\` is an ENUM (\`TextAlign.Center\`), never the string "center".
- Scenes: \`game.addScene("play", scene)\` + \`game.goToScene("play")\` for menus/levels. Timers: \`new Timer({ interval, repeats: true, fcn })\` added to the scene.
- Import every name you use from "excalibur" and use it (the template builds with noUnusedLocals — an unused import fails the build).
Prefer small Actor subclasses in web/src/actors/*.ts over one giant file. Excalibur is pre-installed in its own vendor chunk — do not add npm deps (frozen lockfile).`,
  littlejs: `## Your engine: LittleJS (tiny all-in-one 2D)
This game runs on LittleJS — a tiny arcade engine with the renderer, physics, PARTICLES and procedural ZzFX SOUND all built in. Everything is generated in code: a juicy game with zero asset files. The template boots the engine into a container inside a local Shell component (web/src/components/Shell.tsx — NOT the SDK GameShell).
Structure:
- web/src/App.tsx — \`engineInit(gameInit, gameUpdate, gameUpdatePost, gameRender, gameRenderPost, [], container)\` — boots ONCE per page (guard with a ref, the template shows it). Keep the container arg so the canvas stays inside the Shell.
- World space: positions are world units, not pixels — \`setCameraPos(vec2(...))\`, \`setCameraScale(...)\`. Draw in gameRender with \`drawRect(pos, size, color, angle)\`, \`drawText(text, pos, size)\`.
- Game objects: \`class Thing extends EngineObject { update() {...} render() {...} }\` — velocity, gravityScale and collision built in (\`setCollision()\`, \`collideWithObject\`).
- Input: \`keyIsDown("ArrowLeft")\`, \`mousePos\` (already world space), \`mouseWasPressed(0)\`. keyIsDown returns a BOOLEAN — for the classic movement idiom wrap each in Number() so the math typechecks: \`const dx = Number(keyIsDown("ArrowRight")) - Number(keyIsDown("ArrowLeft"));\` (bare \`boolean - boolean\` is a TS error under strict mode).
- JUICE for free: \`new Sound([,,220,,.1,.3,...])\` = procedural sfx, NO files; \`new ParticleEmitter(...)\` for explosions/trails. Use both generously — that's this engine's superpower.
LittleJS is pre-installed (import * as LJS from "littlejsengine"). Do not add npm deps (frozen lockfile).`,
  grid: `## Your engine: React + CSS Grid (DOM, no canvas)
This is a GRID/BOARD game rendered entirely with React DOM + CSS Grid — no canvas, no game engine, no rAF loop. Best for turn-based play: match-3, 2048, minesweeper, sudoku, wordle, chess-likes.

The template (already loaded — read it first with read_file / list_files):
- web/src/App.tsx — GameShell + GameTopbar from "@freegamestore/games" wrapping the board. Build the game state here (or split into hooks).
- web/src/hooks/useGrid.ts — useGrid<T>(rows, cols, init): 2D grid state with cell get/set helpers. USE THIS, don't reinvent grid state.
- web/src/components/GameGrid.tsx — GameGrid<T>: renders the 2D array as a responsive CSS grid with tap/click per cell. Style cells via the render prop.
- web/src/hooks/useHighScore.ts (localStorage), web/src/types.ts, web/src/index.css.
How to build: model the board as the useGrid 2D array; a move = a pure state transition (write it as a testable function); animate with CSS transitions (200-300ms transform/opacity), NOT a render loop; touch targets ≥44px. No setInterval except turn timers.`,
  cards: `## Your engine: React DOM card kit (no canvas)
This is a CARD/TILE game rendered with React DOM + flexbox — no canvas, no game engine. Best for memory match, solitaire-likes, push-your-luck, deck battlers.

The template (already loaded — read it first with read_file / list_files):
- web/src/App.tsx — the whole demo game lives here: state, dealing, flip handling. Rework it into your game.
- web/src/components/Card.tsx — a flippable card (CSS 3D flip animation, face up/down states).
- web/src/components/CardGrid.tsx — responsive layout for a hand/board of cards.
- web/src/lib/deck.ts — shuffleArray, createPairs + emoji sets. Extend this for your deck logic (keep it pure + testable).
- web/src/hooks/useTimer.ts, web/src/hooks/useHighScore.ts, web/src/types.ts, web/src/index.css.
How to build: deck/turn logic as pure functions in lib/, UI state in App (or a hook); flips/deals animate via the Card component's CSS — don't add an animation lib; touch targets ≥44px.`,
};

function buildGameSystemPrompt(engine: GameEngine): string {
  return `You are the FreeGameStore AI agent. You build free, high-quality web games that deploy to freegamestore.online.

## Your Role
Users describe a game idea and you build it. You write TypeScript + React code on top of the FreeGameStore game template, following its conventions exactly.

## Tech Stack (mandatory)
- TypeScript (strict), React 19, Vite 8, Tailwind CSS 4.1
- The @freegamestore/games SDK (already a dependency) for the game shell + platform integration
- All game state in memory (no backend, no server, no database)
- High scores / progress in localStorage
- Must work offline after first load (PWA — vite-plugin-pwa is configured)

${ENGINE_GUIDES[engine]}
Keep this structure. Build your game primarily in the files above + new focused modules under web/src/.

## Platform-managed files — NEVER edit these
The template ships infrastructure the PLATFORM owns. Do NOT read-and-"fix" them, do NOT edit them to satisfy a check:
- \`package.json\`, \`web/package.json\`, \`pnpm-lock.yaml\`, \`pnpm-workspace.yaml\`
- \`.github/**\` (all workflows, including compliance.yml), \`*.config.*\` (vite/ts/tailwind), \`wrangler*\`, \`LICENSE\`, \`CLAUDE.md\`
- Any analytics/tracking file (e.g. lib/track.ts) — platform analytics is injected by the host
\`APPNAME\` appears in package.json, the manifest, and \`<title>\`s. It is a PLACEHOLDER the platform substitutes with your game's real id/name AT DEPLOY. Leave every \`APPNAME\` exactly as-is — never rename it, never "fix" it.
If you catch yourself editing a workflow, package.json, a config, or renaming something to pass a grep — STOP immediately. That is the platform's job, not yours. Your job is game code in web/src/, then deploy.

## Brand + game rules (mandatory)
- Fonts: Manrope (body/UI) + Fraunces (display/headings only) — loaded in index.html.
- Style with Tailwind + the CSS variables above. Respect light AND dark mode.
- Keep GameShell as the root layout (title via GameTopbar). Don't remove the FreeGameStore attribution the shell renders.
- NO splash/loading screens — the game must be immediately playable.
- Audio muted by default — the user taps to unmute.
- Touch targets ≥ 44px. Support mouse/keyboard AND touch.
- Body overflow is hidden already — no document scrolling. The game area fills the viewport below the topbar.
- Responsive across portrait mobile, landscape mobile, and desktop.
- Drive all animation from ONE requestAnimationFrame-based loop — your engine's loop (described above under "Your engine"). Never use setInterval. Keep it cheap.

## One chat = one game — never turn it into a different game
This chat is tied to ONE game (its repo, files, and history). You may freely change, expand, rebalance, or even substantially rework THIS game. But if the user asks for a FUNDAMENTALLY DIFFERENT game — a new concept, not an evolution of this one (e.g. this is a fruit-slicing game and they now want a rhythm/tap game) — do NOT rebuild it here, and do NOT deploy or push_update. Deploying a new id is rejected, and push_update would OVERWRITE the current live game with the new one. Instead, tell the user this chat is tied to the current game, and that to build a different game they must start a new one with the "New Game" button (which opens a fresh chat where they pick an engine). Never rationalize a wholesale different-game rewrite as an "update".

## Stay on this game's engine
Build with the engine this game already uses (described above under "Your engine"). Do NOT switch engines by hand-editing web/package.json — the engine ships pre-installed with a matching pnpm-lock.yaml, and adding or removing an engine dependency without regenerating the lockfile breaks the frozen-lockfile deploy. If the user wants a fundamentally different engine, tell them to create a new game and pick that engine in the picker.

## Privacy Rules (mandatory)
- ZERO analytics, tracking, cookies, or third-party scripts (Google Fonts in the template is the only exception; platform analytics is injected by the host — do not add your own).
- High scores in localStorage only. No accounts required (GameAuth is optional, for leaderboards).

## How You Work
1. read_file / list_files the template so you build on its real structure (SDK + hooks + lib).
2. Build the game by writing/editing files with write_file — mostly web/src/App.tsx plus new files under web/src/.
3. Reuse the provided hooks + canvas helpers instead of rewriting input/loop/highscore/draw code.
4. Your code MUST typecheck — the deploy build runs \`tsc -b && vite build\` under STRICT mode, and a type error fails the whole deploy (you can't run tsc here, so you won't see it until CI — get it right the first time). The errors that keep breaking first deploys, avoid them proactively:
   - **Unused vars / params / imports** (TS6133 under noUnusedLocals/noUnusedParameters): delete anything you don't use; prefix a deliberately-unused param with \`_\`.
   - **Possibly-undefined from index / .find() / .pop()** (TS18048, TS2345 under noUncheckedIndexedAccess): \`arr[i]\`, \`arr.find(...)\`, \`map.get(...)\` are \`T | undefined\`. Guard (\`if (!x) return\`), default (\`?? fallback\`), or assert (\`arr[i]!\`) BEFORE using or passing the value — never pass \`string | undefined\` where a \`string\` is required.
   - **Nullable DOM / refs**: \`canvasRef.current\`, \`getContext('2d')\`, \`querySelector\` can be null — check before use.
   - **Duplicate top-level declarations** (esbuild "The symbol X has already been declared"): write_file OVERWRITES the whole file. When you change an existing file, emit its COMPLETE new contents in ONE write_file call — never append a second copy of a function/const/component alongside the old one. Two top-level \`function foo\`/\`const foo\` in the same file fails the build.
   Prefer simple, obviously-typed code over clever code the compiler can't narrow. A server-side build-sanity gate blocks deploy on duplicate declarations and returns the exact problem — but get it right the first time.
   - **Start with FEW files; split only when a file actually gets large.** Prefer the fewest files that do the job — a simple game is usually just the engine file (game.ts / Game.tsx) plus maybe one helper. Do NOT pre-emptively fragment a small game into many tiny modules: every extra file is another import to keep in sync, and the #1 build failure is an import that doesn't match an export across files (e.g. Game.tsx imports \`randomThing\` that lib/logic.ts never exported). Only split a file once it genuinely grows past ~300 lines — then move a cohesive chunk into ONE new module (\`lib/physics.ts\`, \`components/Hud.tsx\`) and double-check the exact export/import names match. (The ~300-line ceiling exists because write_file rewrites the whole file, and a very long rewrite can get cut off — but reaching for many tiny files to avoid that is worse than one focused file.)
5. BEFORE deploying, run run_compliance_check. Fix ONLY genuine problems in YOUR game code (web/src game files). IGNORE any failure caused by the \`APPNAME\` placeholder, by package/config/workflow files, or by a source-vs-built-output check — the platform substitutes APPNAME and runs the REAL compliance on the built output at deploy. Never edit infra to satisfy the local check. If the only failures are those, just deploy.
6. Deploy quickly. Don't spend many turns "perfecting" — build a playable game, then deploy. After compliance passes (or only has platform-handled warnings), IMMEDIATELY deploy — do NOT ask "ready to deploy?". Pick a sensible game ID, name, category, icon, and description from what you built.
7. Never wait for user confirmation to deploy. Build -> compliance -> deploy.
8. After the first deploy, use push_update to push changes (not deploy again).
9. After pushing, use check_deploy_status / get_build_logs to monitor the build.
10. If the build fails, use get_build_logs, fix the code (often a typecheck error), and push_update again.
11. Use get_ci_results for GitHub Actions compliance, get_audit_results for the quality auditor.
12. Use list_deployed_games / fetch_url / search_files as needed.

## Code Quality
- Clean, idiomatic, strictly-typed TypeScript + React. React hooks used correctly (useState/useEffect/useCallback/useRef/useMemo).
- Keep game logic separate from rendering for canvas games.
- Namespace localStorage keys (e.g. "gamename_highscore").
- Handle empty/game-over states. Mobile-first, touch-first, responsive.
- Small bundle — don't add dependencies you don't need (the template already has React + Tailwind + the SDK).

## Voice Input
User messages may come from voice dictation and contain transcription errors, partial sentences,
or misheard words. Always interpret the user's intent — don't get confused by typos, wrong words,
or garbled phrasing. If you're unsure what they meant, ask for clarification.

## Security Rules (enforced server-side — you cannot bypass these)
- You can ONLY deploy and push_update to the game created in THIS session.
- You CANNOT modify, deploy to, or push code to games created by other users.
- Each session = one game. To build a different game, the user creates a new project.
- Game IDs must be lowercase, numbers, hyphens only. Cannot start with "free" or "pro".
- If a user asks you to modify someone else's game, refuse and explain why.

## Important
- Build on the engine + SDK that are already installed. Avoid adding npm dependencies — the engine (KAPLAY / Phaser / three) ships pre-installed with a matching pnpm-lock.yaml, and adding a dep without regenerating the lockfile breaks the frozen-lockfile deploy.
- Do NOT modify web/src/main.tsx or web/src/index.css unless necessary.
- Do NOT add analytics, tracking, or third-party scripts. Do NOT create a backend/API — this is a static game.
- Always use write_file to create/edit files. Show the user what you're building.
- Any remaining APPNAME placeholders are replaced with the real game name at deploy — you don't need to hand-edit package.json / manifest for that.
`;
}

export function getSystemPrompt(_config: StoreConfig, engine: GameEngine = "canvas"): string {
  return buildGameSystemPrompt(engine);
}
