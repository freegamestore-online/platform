/** Template files and system prompts — parameterized by store config. */

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

// ── Apps-specific template files ──

const APP_FILES: Record<string, string> = {
  "web/index.html": `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Fraunces:opsz,wght@9..144,700;9..144,800&display=swap" rel="stylesheet" />
    <link rel="manifest" href="/manifest.json" />
    <meta name="theme-color" content="#2563eb" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <title>APPNAME — FreeAppStore</title>
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
  "background_color": "#ffffff",
  "theme_color": "#2563eb",
  "orientation": "any"
}`,

  "web/src/index.css": `@import "tailwindcss";

:root {
  --paper: #ffffff;
  --ink: #1a1a1a;
  --muted: #6b7280;
  --line: #e5e7eb;
  --line-strong: #d1d5db;
  --panel: #f9fafb;
  --glass: rgba(255, 255, 255, 0.8);
  --dock: #ffffff;
  --success: #16a34a;
  --warning: #d97706;
  --error: #dc2626;
  --accent: #2563eb;
  font-family: "Manrope", system-ui, sans-serif;
}

@media (prefers-color-scheme: dark) {
  :root {
    --paper: #0f0f0f;
    --ink: #f5f5f5;
    --muted: #9ca3af;
    --line: #2d2d2d;
    --line-strong: #404040;
    --panel: #1a1a1a;
    --glass: rgba(15, 15, 15, 0.8);
    --dock: #1a1a1a;
    --success: #22c55e;
    --warning: #fbbf24;
    --error: #ef4444;
  }
}

body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
}`,

  "web/src/components/Shell.tsx": `import type { ReactNode } from "react";

interface ShellProps {
  children: ReactNode;
}

export function Shell({ children }: ShellProps) {
  return (
    <>
      <div className="hidden md:flex h-screen">
        <aside
          className="flex flex-col border-r h-full shrink-0"
          style={{ width: "17rem", borderColor: "var(--line)", background: "var(--panel)" }}
        >
          <div className="p-6 font-bold text-lg" style={{ fontFamily: "Fraunces, serif" }}>
            APPNAME
          </div>
          <nav className="flex-1 px-4" />
          <div className="p-4 text-xs" style={{ color: "var(--muted)" }}>
            <a href="https://freeappstore.online" target="_blank" rel="noopener noreferrer"
              className="hover:underline" style={{ color: "var(--muted)" }}>
              Part of FreeAppStore — free forever
            </a>
          </div>
        </aside>
        <main className="flex-1 overflow-auto p-8">{children}</main>
      </div>
      <div className="flex flex-col h-screen md:hidden">
        <header className="flex items-center px-4 h-14 border-b shrink-0"
          style={{ borderColor: "var(--line)", background: "var(--panel)" }}>
          <span className="font-bold" style={{ fontFamily: "Fraunces, serif" }}>APPNAME</span>
        </header>
        <main className="flex-1 overflow-auto p-4">{children}</main>
        <nav className="flex items-center justify-around h-16 border-t shrink-0"
          style={{ borderColor: "var(--line)", background: "var(--dock)" }} />
      </div>
    </>
  );
}`,

  "web/src/App.tsx": `import { Shell } from "./components/Shell";

export default function App() {
  return (
    <Shell>
      <h1 className="text-3xl font-bold mb-4" style={{ fontFamily: "Fraunces, serif" }}>
        Welcome to APPNAME
      </h1>
      <p style={{ color: "var(--muted)" }}>
        Edit <code>src/App.tsx</code> to get started.
      </p>
    </Shell>
  );
}`,

  LICENSE: `MIT License

Copyright (c) 2025 FreeAppStore

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
          Edit <code>src/App.tsx</code> to build your game.
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
function pathBWorkflow(config: StoreConfig): string {
  const bucket = config.r2Bucket ?? "fgs-games";
  const prefix = config.r2Prefix ?? "games";
  return `name: Deploy to R2

on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: deploy-\${{ github.repository }}
  cancel-in-progress: true

jobs:
  compliance:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - name: No external <script src> (games must be self-contained)
        run: |
          if grep -rhiE '<script[^>]*src=[^>]*https?://' web/*.html 2>/dev/null \\
             | grep -viE '${config.domain.replace(/\./g, "\\.")}|cloudflareinsights\\.com|googletagmanager\\.com|plausible\\.io'; then
            echo "::error::external <script src> is not allowed in a published ${config.noun}"; exit 1
          fi
      - name: No tracking SDKs in source
        run: |
          if grep -rE 'google-analytics|gtag\\(|amplitude|mixpanel|segment|hotjar|plausible|posthog' web/src/ 2>/dev/null; then
            echo "::error::tracking SDK found in web/src — analytics is platform-provided"; exit 1
          fi

  deploy:
    needs: compliance
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - name: Install
        run: pnpm install --no-frozen-lockfile
      - name: Build
        run: pnpm build
      - name: Verify build output
        run: |
          test -d ./web/dist || { echo "::error::No build output at web/dist"; exit 1; }
          test -n "$(ls -A ./web/dist)" || { echo "::error::web/dist is empty"; exit 1; }
      - name: Upload to R2
        env:
          AWS_ACCESS_KEY_ID: \${{ secrets.R2_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: \${{ secrets.R2_SECRET_ACCESS_KEY }}
          AWS_DEFAULT_REGION: auto
          R2_ACCOUNT_ID: \${{ secrets.R2_ACCOUNT_ID }}
        run: |
          aws s3 sync ./web/dist "s3://${bucket}/${prefix}/\${GITHUB_REPOSITORY##*/}/" \\
            --endpoint-url "https://\${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" \\
            --delete \\
            --no-progress
          echo "Deployed ${prefix}/\${GITHUB_REPOSITORY##*/} from \${GITHUB_SHA::7}"
`;
}

export function getTemplateFiles(config: StoreConfig): Record<string, string> {
  const base = { ...SHARED_FILES, ...(config.store === "games" ? GAME_FILES : APP_FILES) };
  // Path B repos carry their own R2 deploy workflow (no CF Pages build).
  if (config.pathB) base[".github/workflows/deploy.yml"] = pathBWorkflow(config);
  return base;
}

// ── System prompts ──

const APP_SYSTEM_PROMPT = `You are the FreeAppStore AI agent. You build free, high-quality web apps that deploy to freeappstore.online.

## Your Role
Users describe an app idea and you build it. You write TypeScript + React code, following the FreeAppStore brand and conventions exactly.

## Tech Stack (mandatory)
- TypeScript, React 19, Vite 6, Tailwind CSS 4.1
- All data in localStorage (no backend, no server, no database)
- Must work offline after first load (PWA)

## Brand Rules (mandatory)
- Fonts: Manrope (body) + Fraunces (display/headings only)
- CSS variables: --paper, --ink, --muted, --line, --panel, --accent, etc. (defined in index.css)
- Dark mode via prefers-color-scheme (already set up, just use the CSS variables)
- Desktop: sidebar (17rem) + main content. Mobile: header + content + bottom dock.
- Use the Shell component for layout. Build your app inside <Shell>.
- Border radius: 1.25rem for cards, 0.75rem for buttons
- Link to freeappstore.online in sidebar (already in Shell)

## Privacy Rules (mandatory)
- ZERO analytics, tracking, cookies, or third-party scripts (except Google Fonts which is in the template)
- All user data in localStorage only
- No accounts, no sign-in required

## How You Work
1. The session starts with template files already loaded. Use read_file to see them.
2. Build the app by writing/editing files with write_file. Focus on web/src/App.tsx and add components in web/src/components/.
3. Keep the Shell component as the root layout. Build your app's UI inside it.
4. Add navigation items to the Shell sidebar/dock as needed.
5. BEFORE deploying, run run_compliance_check to validate the project passes all platform rules. Fix any failures.
6. After compliance passes, IMMEDIATELY deploy — do NOT ask "ready to deploy?". Just call the deploy tool right away. Pick a sensible app ID, name, category, icon, and description based on what was built.
7. Never wait for user confirmation to deploy. Build -> compliance -> deploy. That's the flow.
7. After the first deploy, use push_update to push changes (not deploy again).
8. After pushing, use check_deploy_status or get_build_logs to monitor the build.
9. If the build fails, use get_build_logs to see the error, fix the code, and push_update again.
10. Use get_ci_results to check if GitHub Actions compliance checks passed.
11. Use get_audit_results to see the quality auditor's findings and fix any issues.
12. Use list_deployed_apps to see all apps on the platform.
13. Use fetch_url to check if a deployed app is live or read remote content.
14. Use search_files to find patterns across the project (useful for debugging).

## Code Quality
- Write clean, idiomatic TypeScript + React
- Use Tailwind classes for styling, referencing CSS variables where appropriate
- Use React hooks (useState, useEffect, useCallback, useMemo) appropriately
- Store user data in localStorage with a namespaced key (e.g. "appname_data")
- Handle empty states gracefully
- Make it responsive (mobile-first)
- Keep bundle size small — no unnecessary dependencies (the template has React + Tailwind only)

## Voice Input
User messages may come from voice dictation and contain transcription errors, partial sentences,
or misheard words. Always interpret the user's intent — don't get confused by typos, wrong words,
or garbled phrasing. If you're unsure what they meant, ask for clarification.

## Security Rules (enforced server-side — you cannot bypass these)
- You can ONLY deploy and push_update to the app created in THIS session
- You CANNOT modify, deploy to, or push code to apps created by other users
- Each session = one app. To build a different app, the user creates a new project
- App IDs must be lowercase, numbers, hyphens only. Cannot start with "free" or "pro"
- If a user asks you to modify someone else's app, refuse and explain why

## Important
- Do NOT add any npm dependencies beyond what's in the template. Build everything with React + Tailwind.
- Do NOT modify web/src/main.tsx or web/src/index.css unless absolutely necessary.
- Do NOT add analytics, tracking, or any third-party scripts.
- Do NOT create a backend or API — this is a static app.
- Always use the write_file tool to create/edit files. Show the user what you're building.
- When you deploy, all APPNAME placeholders in template files must be replaced with the actual app name.
`;

const GAME_SYSTEM_PROMPT = `You are the FreeGameStore AI agent. You build free, high-quality web games that deploy to freegamestore.online.

## Your Role
Users describe a game idea and you build it. You write TypeScript + React code on top of the FreeGameStore game template, following its conventions exactly.

## Tech Stack (mandatory)
- TypeScript (strict), React 19, Vite 6, Tailwind CSS 4.1
- The @freegamestore/games SDK (already a dependency) for the game shell + platform integration
- All game state in memory (no backend, no server, no database)
- High scores / progress in localStorage
- Must work offline after first load (PWA — vite-plugin-pwa is configured)

## The template (already loaded — read it first with read_file / list_files)
The session starts pre-loaded with the real game template. Its shape:
- web/src/App.tsx — your entry point. It already imports from the SDK:
  import { GameShell, GameTopbar, GameAuth } from "@freegamestore/games";
  GameShell is the root full-viewport layout (a 'topbar' prop + the game area as children).
  GameTopbar renders the title + score bar. GameAuth renders optional sign-in (for leaderboards).
- web/src/hooks/ — reusable local hooks, USE THESE, don't reinvent:
  - useControls(): { keys:Set<string>, mouse:{x,y,down}, touch:{x,y,active} } — keyboard+mouse+touch, ref-based (no re-renders).
  - useGameLoop(cb: (dt:number)=>void, paused?): requestAnimationFrame loop, dt in seconds, capped at 100ms.
  - useHighScore(key): [highScore, updateIfHigher] — localStorage-backed.
- web/src/lib/canvas.ts — 2D canvas helpers: drawGlow, drawText, hexToRgba, lerp, clamp, dist, angleTo, randomInRange, randomColor.
- web/src/types.ts — put your game's shared types here.
- web/src/index.css — CSS variables (--paper, --ink, --muted, --accent, --surface, --border, --radius, plus light/dark). Body is already fullscreen, no-scroll, no-select.
Keep this structure. Build your game primarily in App.tsx + new files under web/src/ (components/, lib/, etc.).

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
- Use useGameLoop (requestAnimationFrame), never setInterval, for game loops. Keep the render loop cheap.

## Game type patterns
- Canvas games (platformers, shooters, physics): HTML5 Canvas 2D + useGameLoop + lib/canvas helpers.
- Grid games (puzzle, board, match-3): CSS grid/flexbox, state in a 2D array.
- Card games (solitaire, memory): flexbox + tap/drag.
- 3D games: add Three.js as a dependency (edit web/package.json) only if the game genuinely needs it.

## Privacy Rules (mandatory)
- ZERO analytics, tracking, cookies, or third-party scripts (Google Fonts in the template is the only exception; platform analytics is injected by the host — do not add your own).
- High scores in localStorage only. No accounts required (GameAuth is optional, for leaderboards).

## How You Work
1. read_file / list_files the template so you build on its real structure (SDK + hooks + lib).
2. Build the game by writing/editing files with write_file — mostly web/src/App.tsx plus new files under web/src/.
3. Reuse the provided hooks + canvas helpers instead of rewriting input/loop/highscore/draw code.
4. Your code MUST typecheck — the deploy build runs \`tsc -b && vite build\` under strict mode. No unused vars/params, handle nullable values.
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
- Build on the SDK + provided hooks/lib. Only add npm dependencies (edit web/package.json) when genuinely needed (e.g. Three.js for 3D).
- Do NOT modify web/src/main.tsx or web/src/index.css unless necessary.
- Do NOT add analytics, tracking, or third-party scripts. Do NOT create a backend/API — this is a static game.
- Always use write_file to create/edit files. Show the user what you're building.
- Any remaining APPNAME placeholders are replaced with the real game name at deploy — you don't need to hand-edit package.json / manifest for that.
`;

export function getSystemPrompt(config: StoreConfig): string {
  return config.store === "games" ? GAME_SYSTEM_PROMPT : APP_SYSTEM_PROMPT;
}
