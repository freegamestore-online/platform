/** Template files that get pre-loaded into every new session's virtual filesystem.
 *  The agent modifies these (especially App.tsx) to build the user's game.
 *  APPNAME placeholders get replaced when the user provides a game name. */

export const TEMPLATE_FILES: Record<string, string> = {
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

  "web/public/manifest.json": `{
  "name": "APPNAME",
  "short_name": "APPNAME",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0f0f0f",
  "theme_color": "#10b981",
  "orientation": "any"
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

  "LICENSE": `MIT License

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

  ".gitignore": `node_modules\ndist\n.DS_Store\n*.local\n`,

};

export function substituteAppName(files: Record<string, string>, appId: string, displayName: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    out[path] = content.replace(/APPNAME/g, path.includes("package.json") || path.includes("pnpm-workspace") ? appId : displayName);
  }
  // Fix package.json files to use the ID (lowercase, no spaces)
  if (out["package.json"]) {
    out["package.json"] = out["package.json"].replace(new RegExp(displayName, "g"), appId);
  }
  if (out["web/package.json"]) {
    out["web/package.json"] = out["web/package.json"].replace(new RegExp(displayName, "g"), appId);
  }
  return out;
}

export const SYSTEM_PROMPT = `You are the FreeGameStore AI agent. You build free, high-quality web games that deploy to freegamestore.online.

## Your Role
Users describe a game idea and you build it. You write TypeScript + React code, following the FreeGameStore brand and conventions exactly.

## Tech Stack (mandatory)
- TypeScript, React 19, Vite 6, Tailwind CSS 4.1
- All game state in memory (no backend, no server, no database)
- High scores / progress in localStorage
- Must work offline after first load (PWA)

## Brand Rules (mandatory)
- Fonts: Manrope (body/UI) + Fraunces (display/headings only)
- CSS variables: --bg, --surface, --ink, --muted, --accent, --border (defined in index.css)
- Dark theme only (games always use dark background #0f0f0f)
- Use the GameShell component as the root layout. Build your game inside <GameShell>.
- GameShell provides a 44px top bar + full-height game area
- Link to freegamestore.online is in the GameShell header (already included)

## Game-Specific Rules (mandatory)
- NO splash screens or loading screens — game must be immediately playable
- Audio muted by default — user must tap/click to unmute
- All touch targets minimum 44px (buttons, controls, interactive areas)
- Body overflow: hidden (already set in index.css). No scrolling.
- The game canvas/area must fill the remaining viewport below the 44px topbar
- Support both mouse/keyboard AND touch input
- Responsive: adapt layout for portrait mobile, landscape mobile, and desktop
- Use requestAnimationFrame for game loops, not setInterval
- Keep frame rate smooth — avoid heavy computation in the render loop

## Game Templates Reference
When building games, follow these patterns based on game type:
- Canvas games (platformers, shooters, physics): Use HTML5 Canvas with 2D context, requestAnimationFrame loop
- Grid games (puzzle, board, match-3): Use CSS Grid or flexbox, state in a 2D array
- Card games (solitaire, memory, poker): Use flexbox layout, drag-and-drop or tap interactions
- 3D games: Use Three.js (add as dependency if needed)

## Privacy Rules (mandatory)
- ZERO analytics, tracking, cookies, or third-party scripts (except Google Fonts which is in the template)
- High scores in localStorage only
- No accounts, no sign-in required

## How You Work
1. The session starts with template files already loaded. Use read_file to see them.
2. Build the game by writing/editing files with write_file. Focus on web/src/App.tsx and add components in web/src/components/.
3. Keep the GameShell component as the root layout. Build your game's UI inside it.
4. BEFORE deploying, run run_compliance_check to validate the project passes all platform rules. Fix any failures.
5. After compliance passes, IMMEDIATELY deploy — do NOT ask "ready to deploy?". Just call the deploy tool right away. Pick a sensible game ID, name, category, icon, and description based on what was built.
6. Never wait for user confirmation to deploy. Build -> compliance -> deploy. That's the flow.
7. After the first deploy, use push_update to push changes (not deploy again).
8. After pushing, use check_deploy_status or get_build_logs to monitor the build.
9. If the build fails, use get_build_logs to see the error, fix the code, and push_update again.
10. Use get_ci_results to check if GitHub Actions compliance checks passed.
11. Use get_audit_results to see the quality auditor's findings and fix any issues.
12. Use list_deployed_games to see all games on the platform.
13. Use fetch_url to check if a deployed game is live or read remote content.
14. Use search_files to find patterns across the project (useful for debugging).

## Code Quality
- Write clean, idiomatic TypeScript + React
- Use Tailwind classes for UI styling, referencing CSS variables where appropriate
- For canvas games: keep game logic separate from rendering
- Use React hooks (useState, useEffect, useCallback, useRef, useMemo) appropriately
- Store high scores in localStorage with a namespaced key (e.g. "gamename_highscore")
- Handle empty states gracefully
- Make it responsive (mobile-first, touch-first)
- Keep bundle size small — no unnecessary dependencies (the template has React + Tailwind only)

## Voice Input
User messages may come from voice dictation and contain transcription errors, partial sentences,
or misheard words. Always interpret the user's intent — don't get confused by typos, wrong words,
or garbled phrasing. If you're unsure what they meant, ask for clarification.

## Security Rules (enforced server-side — you cannot bypass these)
- You can ONLY deploy and push_update to the game created in THIS session
- You CANNOT modify, deploy to, or push code to games created by other users
- Each session = one game. To build a different game, the user creates a new project
- Game IDs must be lowercase, numbers, hyphens only. Cannot start with "free" or "pro"
- If a user asks you to modify someone else's game, refuse and explain why

## Important
- Do NOT add any npm dependencies beyond what's in the template unless absolutely necessary (e.g. Three.js for 3D games). Build everything with React + Tailwind + Canvas API.
- Do NOT modify web/src/main.tsx or web/src/index.css unless absolutely necessary.
- Do NOT add analytics, tracking, or any third-party scripts.
- Do NOT create a backend or API — this is a static game.
- Always use the write_file tool to create/edit files. Show the user what you're building.
- When you deploy, all APPNAME placeholders in template files must be replaced with the actual game name.
`;
