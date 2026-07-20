import { describe, expect, it } from "vitest";
import { getConfig } from "./config";
import { getSystemPrompt, getTemplateFiles, detectEngine, ENGINE_TEMPLATE_REPOS } from "./template";

const appsConfig = getConfig("apps");
const gamesConfig = getConfig("games");

describe("getTemplateFiles", () => {
  const appsFiles = getTemplateFiles(appsConfig);
  const gamesFiles = getTemplateFiles(gamesConfig);

  it("apps template has Shell.tsx, not GameShell.tsx", () => {
    expect(appsFiles).toHaveProperty("web/src/components/Shell.tsx");
    expect(appsFiles).not.toHaveProperty("web/src/components/GameShell.tsx");
  });

  it("games template has GameShell.tsx, not Shell.tsx", () => {
    expect(gamesFiles).toHaveProperty("web/src/components/GameShell.tsx");
    expect(gamesFiles).not.toHaveProperty("web/src/components/Shell.tsx");
  });

  it("apps template uses --paper CSS variable", () => {
    expect(appsFiles["web/src/index.css"]).toContain("--paper");
  });

  it("games template uses --bg CSS variable", () => {
    expect(gamesFiles["web/src/index.css"]).toContain("--bg");
  });

  it("apps template has light/dark theme", () => {
    expect(appsFiles["web/src/index.css"]).toContain("prefers-color-scheme: dark");
  });

  it("games template has overflow: hidden", () => {
    expect(gamesFiles["web/src/index.css"]).toContain("overflow: hidden");
  });

  it("apps theme color is blue", () => {
    expect(appsFiles["web/index.html"]).toContain("#2563eb");
    expect(appsFiles["web/public/manifest.json"]).toContain("#2563eb");
  });

  it("games theme color is green", () => {
    expect(gamesFiles["web/index.html"]).toContain("#10b981");
    expect(gamesFiles["web/public/manifest.json"]).toContain("#10b981");
  });

  it("apps title references FreeAppStore", () => {
    expect(appsFiles["web/index.html"]).toContain("FreeAppStore");
  });

  it("games title references FreeGameStore", () => {
    expect(gamesFiles["web/index.html"]).toContain("FreeGameStore");
  });

  it("apps Shell links to freeappstore.online", () => {
    expect(appsFiles["web/src/components/Shell.tsx"]).toContain("freeappstore.online");
  });

  it("games GameShell links to freegamestore.online", () => {
    expect(gamesFiles["web/src/components/GameShell.tsx"]).toContain("freegamestore.online");
  });

  it("apps LICENSE says FreeAppStore", () => {
    expect(appsFiles.LICENSE).toContain("FreeAppStore");
  });

  it("games LICENSE says FreeGameStore", () => {
    expect(gamesFiles.LICENSE).toContain("FreeGameStore");
  });

  it("shared files are identical between stores", () => {
    const sharedPaths = [
      "pnpm-workspace.yaml",
      "package.json",
      "web/package.json",
      "web/vite.config.ts",
      "web/tsconfig.json",
      "web/tsconfig.app.json",
      "web/tsconfig.node.json",
      "web/src/main.tsx",
      ".gitignore",
    ];
    for (const p of sharedPaths) {
      expect(appsFiles[p]).toBe(gamesFiles[p]);
    }
  });

  it("apps and games share the same base files; games adds the Path B deploy workflow", () => {
    // Games are on Path B: their repo carries its own R2 deploy.yml (apps still
    // build via CF Pages, so they don't). Otherwise the file sets match.
    expect(gamesFiles[".github/workflows/deploy.yml"]).toBeTruthy();
    expect(appsFiles[".github/workflows/deploy.yml"]).toBeUndefined();
    expect(Object.keys(gamesFiles).length).toBe(Object.keys(appsFiles).length + 1);
  });
});

describe("getSystemPrompt", () => {
  it("apps prompt mentions FreeAppStore", () => {
    const prompt = getSystemPrompt(appsConfig);
    expect(prompt).toContain("FreeAppStore");
    expect(prompt).not.toContain("FreeGameStore");
  });

  it("games prompt mentions FreeGameStore", () => {
    const prompt = getSystemPrompt(gamesConfig);
    expect(prompt).toContain("FreeGameStore");
    expect(prompt).not.toContain("FreeAppStore");
  });

  it("apps prompt references Shell component", () => {
    expect(getSystemPrompt(appsConfig)).toContain("Shell");
  });

  it("games prompt references GameShell component", () => {
    expect(getSystemPrompt(gamesConfig)).toContain("GameShell");
  });

  it("apps prompt references list_deployed_apps", () => {
    expect(getSystemPrompt(appsConfig)).toContain("list_deployed_apps");
  });

  it("games prompt references list_deployed_games", () => {
    expect(getSystemPrompt(gamesConfig)).toContain("list_deployed_games");
  });

  it("games prompt has game-specific rules", () => {
    const prompt = getSystemPrompt(gamesConfig);
    expect(prompt).toContain("requestAnimationFrame");
    expect(prompt).toContain("Canvas");
    // The prompt must teach the real SDK-based template, not the obsolete
    // local-GameShell scaffold.
    expect(prompt).toContain("@freegamestore/games");
    expect(prompt).toContain("GameShell");
    expect(prompt).toContain("useGameLoop");
  });

  it("apps prompt has app-specific rules", () => {
    const prompt = getSystemPrompt(appsConfig);
    expect(prompt).toContain("localStorage");
    expect(prompt).toContain("Dark mode");
    expect(prompt).toContain("sidebar");
  });
});

describe("detectEngine", () => {
  const filesWith = (webPkg: unknown): Map<string, string> =>
    new Map([["web/package.json", JSON.stringify(webPkg)]]);

  it("detects phaser from dependencies", () => {
    expect(detectEngine(filesWith({ dependencies: { phaser: "^3.90.0" } }))).toBe("phaser");
  });

  it("detects kaplay from dependencies", () => {
    expect(detectEngine(filesWith({ dependencies: { kaplay: "^3001.0.0" } }))).toBe("kaplay");
  });

  it("detects r3f from @react-three/fiber", () => {
    expect(detectEngine(filesWith({ dependencies: { "@react-three/fiber": "^9", three: "^0.184" } }))).toBe("r3f");
  });

  it("detects r3f from a bare three dependency", () => {
    expect(detectEngine(filesWith({ dependencies: { three: "^0.184" } }))).toBe("r3f");
  });

  it("detects pixi from pixi.js", () => {
    expect(detectEngine(filesWith({ dependencies: { "pixi.js": "^8" } }))).toBe("pixi");
  });

  it("detects babylon from @babylonjs/core", () => {
    expect(detectEngine(filesWith({ dependencies: { "@babylonjs/core": "^7" } }))).toBe("babylon");
  });

  it("detects grid from the useGrid template kit file", () => {
    const files = filesWith({ dependencies: { react: "^19" } });
    files.set("web/src/hooks/useGrid.ts", "export function useGrid() {}");
    expect(detectEngine(files)).toBe("grid");
  });

  it("detects cards from the deck template kit file", () => {
    const files = filesWith({ dependencies: { react: "^19" } });
    files.set("web/src/lib/deck.ts", "export function shuffleArray() {}");
    expect(detectEngine(files)).toBe("cards");
  });

  it("detects excalibur from dependencies", () => {
    expect(detectEngine(filesWith({ dependencies: { excalibur: "^0.32.0" } }))).toBe("excalibur");
  });

  it("detects littlejs from littlejsengine", () => {
    expect(detectEngine(filesWith({ dependencies: { littlejsengine: "^1.18.21" } }))).toBe("littlejs");
  });

  it("defaults to canvas when no engine dependency is present", () => {
    expect(detectEngine(filesWith({ dependencies: { react: "^19", "@freegamestore/games": "^0.14.0" } }))).toBe("canvas");
  });

  it("defaults to canvas when web/package.json is missing", () => {
    expect(detectEngine(new Map())).toBe("canvas");
  });

  it("defaults to canvas when web/package.json is unparseable", () => {
    expect(detectEngine(new Map([["web/package.json", "{ not json"]]))).toBe("canvas");
  });

  it("prefers phaser over an incidental three (only one engine wins deterministically)", () => {
    // Guard the precedence order: phaser is checked before three/r3f.
    expect(detectEngine(filesWith({ dependencies: { phaser: "^3.90.0", three: "^0.184" } }))).toBe("phaser");
  });
});

describe("getSystemPrompt — per engine", () => {
  const promptFor = (engine: Parameters<typeof getSystemPrompt>[1]) => getSystemPrompt(gamesConfig, engine);

  // `drawGlow` is a symbol unique to the raw-canvas lib/canvas helpers, so its
  // absence proves the engine guide isn't teaching canvas helpers as the build
  // path (the guides may still *mention* useGameLoop in a "do NOT use" warning).
  it("kaplay prompt teaches KAPLAY, not the canvas helpers", () => {
    const prompt = promptFor("kaplay");
    expect(prompt).toContain("KAPLAY");
    expect(prompt).toContain("k.add");
    expect(prompt).toContain("game.ts");
    expect(prompt).not.toContain("drawGlow");
  });

  it("phaser prompt teaches Phaser scenes + arcade physics, not the canvas helpers", () => {
    const prompt = promptFor("phaser");
    expect(prompt).toContain("Phaser");
    expect(prompt).toContain("Phaser.Scene");
    expect(prompt).toContain("Arcade");
    expect(prompt).not.toContain("drawGlow");
  });

  it("r3f prompt teaches react-three-fiber + useFrame", () => {
    const prompt = promptFor("r3f");
    expect(prompt).toContain("react-three-fiber");
    expect(prompt).toContain("useFrame");
    expect(prompt).not.toContain("drawGlow");
  });

  it("canvas is the default engine and keeps the raw-canvas helpers", () => {
    expect(getSystemPrompt(gamesConfig)).toBe(promptFor("canvas"));
    expect(promptFor("canvas")).toContain("useGameLoop");
    expect(promptFor("canvas")).toContain("lib/canvas");
  });

  it("every engine prompt keeps the shared platform + security rules", () => {
    for (const engine of ["canvas", "kaplay", "phaser", "r3f"] as const) {
      const prompt = promptFor(engine);
      expect(prompt).toContain("FreeGameStore");
      expect(prompt).toContain("GameShell");
      expect(prompt).toContain("@freegamestore/games");
      expect(prompt).toContain("list_deployed_games");
      // Never leak the wrong store's brand into a game prompt.
      expect(prompt).not.toContain("FreeAppStore");
      // The deploy/security guardrails must survive the engine split.
      expect(prompt).toContain("push_update");
      expect(prompt).toContain("frozen-lockfile");
    }
  });
});

describe("ENGINE_TEMPLATE_REPOS (session seeding map)", () => {
  it("covers exactly the 10 public engine keys", () => {
    expect(Object.keys(ENGINE_TEMPLATE_REPOS).sort()).toEqual(
      ["3d", "babylon", "canvas", "cards", "excalibur", "grid", "kaplay", "littlejs", "phaser", "pixi"],
    );
  });

  it("maps every key to a template-game-* repo", () => {
    for (const repo of Object.values(ENGINE_TEMPLATE_REPOS)) {
      expect(repo).toMatch(/^template-game-[a-z0-9]+$/);
    }
  });
});

describe("engine guides", () => {
  const guideMarkers: Record<string, string> = {
    canvas: "raw HTML5 Canvas",
    kaplay: "KAPLAY",
    phaser: "Phaser 4",
    r3f: "react-three-fiber",
    pixi: "Pixi.js v8",
    babylon: "Babylon.js",
    excalibur: "Excalibur",
    littlejs: "LittleJS",
    grid: "CSS Grid",
    cards: "card kit",
  };

  for (const [engine, marker] of Object.entries(guideMarkers)) {
    it(`games system prompt for "${engine}" teaches ${marker}`, () => {
      const prompt = getSystemPrompt(gamesConfig, engine as never);
      expect(prompt).toContain("## Your engine");
      expect(prompt).toContain(marker);
    });
  }

  it("grid guide points at the template's kit, not canvas helpers", () => {
    const prompt = getSystemPrompt(gamesConfig, "grid" as never);
    expect(prompt).toContain("useGrid");
    expect(prompt).toContain("GameGrid");
    expect(prompt).not.toContain("lib/canvas.ts");
  });

  it("cards guide points at the deck kit, not canvas helpers", () => {
    const prompt = getSystemPrompt(gamesConfig, "cards" as never);
    expect(prompt).toContain("deck.ts");
    expect(prompt).toContain("Card.tsx");
    expect(prompt).not.toContain("lib/canvas.ts");
  });
});
