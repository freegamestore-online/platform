import { describe, expect, it } from "vitest";
import { getConfig } from "./config";
import { getTemplateFiles } from "./template";
import {
  clampToolResultForHistory,
  DEFAULT_TOOL_HISTORY_CAP,
  executeTool,
  getToolDefinitions,
  INFRA_TOOLS,
  looksLikePlaceholder,
  READ_FILE_HISTORY_CAP,
  validateImports,
  WRITE_FILE_MAX_BYTES,
  WRITE_FILE_MAX_FILES,
  WRITE_FILE_MAX_TOTAL_BYTES,
} from "./tools";

const appsConfig = getConfig("apps");
const gamesConfig = getConfig("games");

describe("getToolDefinitions", () => {
  const appsTools = getToolDefinitions(appsConfig);
  const gamesTools = getToolDefinitions(gamesConfig);

  it("apps tools include list_deployed_apps", async () => {
    const names = appsTools.map((t) => t.name);
    expect(names).toContain("list_deployed_apps");
    expect(names).not.toContain("list_deployed_games");
  });

  it("games tools include list_deployed_games", async () => {
    const names = gamesTools.map((t) => t.name);
    expect(names).toContain("list_deployed_games");
    expect(names).not.toContain("list_deployed_apps");
  });

  it("both have same number of tools", async () => {
    expect(appsTools.length).toBe(gamesTools.length);
  });

  it("apps deploy tool mentions app categories", async () => {
    const deploy = appsTools.find((t) => t.name === "deploy")!;
    expect(deploy.parameters.properties.category.description).toContain("utilities");
    expect(deploy.parameters.properties.category.description).toContain("productivity");
  });

  it("games deploy tool mentions game categories", async () => {
    const deploy = gamesTools.find((t) => t.name === "deploy")!;
    expect(deploy.parameters.properties.category.description).toContain("arcade");
    expect(deploy.parameters.properties.category.description).toContain("puzzle");
  });

  it("apps tool descriptions say 'app'", async () => {
    const deploy = appsTools.find((t) => t.name === "deploy")!;
    expect(deploy.description).toContain("app");
  });

  it("games tool descriptions say 'game'", async () => {
    const deploy = gamesTools.find((t) => t.name === "deploy")!;
    expect(deploy.description).toContain("game");
  });

  it("apps compliance check references FreeAppStore", async () => {
    const check = appsTools.find((t) => t.name === "run_compliance_check")!;
    expect(check.description).toContain("FreeAppStore");
  });

  it("games compliance check references FreeGameStore", async () => {
    const check = gamesTools.find((t) => t.name === "run_compliance_check")!;
    expect(check.description).toContain("FreeGameStore");
  });

  it("file tools are identical between stores", async () => {
    const fileToolNames = ["write_file", "read_file", "list_files", "delete_file", "search_files"];
    for (const name of fileToolNames) {
      const appTool = appsTools.find((t) => t.name === name)!;
      const gameTool = gamesTools.find((t) => t.name === name)!;
      expect(appTool).toEqual(gameTool);
    }
  });
});

describe("INFRA_TOOLS", () => {
  it("includes both list_deployed variants", async () => {
    expect(INFRA_TOOLS.has("list_deployed_apps")).toBe(true);
    expect(INFRA_TOOLS.has("list_deployed_games")).toBe(true);
  });

  it("includes core infra tools", async () => {
    expect(INFRA_TOOLS.has("deploy")).toBe(true);
    expect(INFRA_TOOLS.has("push_update")).toBe(true);
    expect(INFRA_TOOLS.has("check_deploy_status")).toBe(true);
    expect(INFRA_TOOLS.has("fetch_url")).toBe(true);
    expect(INFRA_TOOLS.has("get_build_logs")).toBe(true);
    expect(INFRA_TOOLS.has("get_ci_results")).toBe(true);
    expect(INFRA_TOOLS.has("get_audit_results")).toBe(true);
  });

  it("does not include file tools", async () => {
    expect(INFRA_TOOLS.has("write_file")).toBe(false);
    expect(INFRA_TOOLS.has("read_file")).toBe(false);
    expect(INFRA_TOOLS.has("search_files")).toBe(false);
  });
});

describe("executeTool — file tools", () => {
  it("write_file and read_file round-trip", async () => {
    const files = new Map<string, string>();
    const write = await executeTool({ id: "1", name: "write_file", input: { path: "test.txt", content: "hello" } }, files, appsConfig);
    expect(write.content).toContain("Wrote test.txt");
    const read = await executeTool({ id: "2", name: "read_file", input: { path: "test.txt" } }, files, appsConfig);
    expect(read.content).toBe("hello");
  });

  it("read_file errors on missing file", async () => {
    const files = new Map<string, string>();
    const result = await executeTool({ id: "1", name: "read_file", input: { path: "nope.txt" } }, files, appsConfig);
    expect(result.isError).toBe(true);
  });

  it("accepts a big-shrink write but WARNS (refactor-friendly; truncation caught at build, not by wedging)", async () => {
    const files = new Map<string, string>();
    files.set("web/src/lib/physics.ts", "x".repeat(5894));
    // A >90% shrink used to be hard-REJECTED, but that false-positived on
    // intentional modularization (slim a big file, move code to new modules) and
    // the agent looped on the rejection → no-progress breaker killed the session
    // (the 3D-template wedge). Now accept + warn; a genuine truncation is caught
    // by the build gate (which blocks deploy), so nothing broken ships.
    const result = await executeTool(
      { id: "1", name: "write_file", input: { path: "web/src/lib/physics.ts", content: 'import { Bird } from "../types";' } },
      files,
      appsConfig,
    );
    expect(result.isError).toBeFalsy();
    expect(result.content).toMatch(/90% smaller|re-send the COMPLETE file/i);
    expect(files.get("web/src/lib/physics.ts")).toBe('import { Bird } from "../types";'); // write applied
  });

  it("does NOT warn on a moderate shrink (normal edit)", async () => {
    const files = new Map<string, string>([["a.ts", "y".repeat(2000)]]);
    const r = await executeTool({ id: "1", name: "write_file", input: { path: "a.ts", content: "z".repeat(1200) } }, files, appsConfig);
    expect(r.isError).toBeFalsy();
    expect(r.content).not.toMatch(/90% smaller/);
  });

  it("allows a normal edit and a legitimate moderate shrink", async () => {
    const files = new Map<string, string>();
    files.set("a.ts", "y".repeat(2000));
    // 40% shrink is a real edit, not truncation → allowed.
    const ok = await executeTool({ id: "1", name: "write_file", input: { path: "a.ts", content: "z".repeat(1200) } }, files, appsConfig);
    expect(ok.isError).toBeFalsy();
    // A brand-new small file is fine (no prior content to compare).
    const nu = await executeTool({ id: "2", name: "write_file", input: { path: "b.ts", content: "hi" } }, files, appsConfig);
    expect(nu.isError).toBeFalsy();
  });

  it("delete_file removes file", async () => {
    const files = new Map([["a.txt", "content"]]);
    await executeTool({ id: "1", name: "delete_file", input: { path: "a.txt" } }, files, appsConfig);
    expect(files.has("a.txt")).toBe(false);
  });

  it("list_files returns sorted paths", async () => {
    const files = new Map([
      ["b.txt", ""],
      ["a.txt", ""],
    ]);
    const result = await executeTool({ id: "1", name: "list_files", input: {} }, files, appsConfig);
    expect(result.content).toBe("a.txt\nb.txt");
  });

  it("search_files finds matches", async () => {
    const files = new Map([["a.txt", "hello world\nfoo bar"]]);
    const result = await executeTool({ id: "1", name: "search_files", input: { pattern: "foo" } }, files, appsConfig);
    expect(result.content).toContain("a.txt:2:");
  });

  it("search_files supports alternation (a|b and grep-style a\\|b)", async () => {
    const files = new Map([["App.tsx", "const w = 1;\nconst h = 2;\nuseEffect(() => {});\nplain line"]]);
    // `a|b` — either term.
    const or = await executeTool({ id: "1", name: "search_files", input: { pattern: "const w =|useEffect" } }, files, appsConfig);
    expect(or.content).toContain("App.tsx:1:");
    expect(or.content).toContain("App.tsx:3:");
    expect(or.content).not.toContain("plain line");
    // grep BRE-style `\|` (what the model often emits) matches the same, instead
    // of being taken literally and returning nothing (the angrry "stuck" bug).
    const bre = await executeTool(
      { id: "2", name: "search_files", input: { pattern: "innerWidth\\|const h =\\|resize" } },
      files,
      appsConfig,
    );
    expect(bre.content).toContain("App.tsx:2:");
    expect(bre.isError).toBeFalsy();
  });
});

describe("looksLikePlaceholder (echoed-status / elision guard)", () => {
  it("flags tool-result-shaped status echoes (the angrry loop)", async () => {
    // The exact content angrry looped on, plus close variants.
    expect(looksLikePlaceholder("[3038 bytes written to web/src/lib/levels.ts]")).toBe(true);
    expect(looksLikePlaceholder("3038 bytes written to levels.ts")).toBe(true);
    expect(looksLikePlaceholder("2.5 KB written to App.tsx")).toBe(true);
    expect(looksLikePlaceholder("Wrote web/src/App.tsx (3038 bytes)")).toBe(true);
    expect(looksLikePlaceholder("[content omitted for brevity]")).toBe(true);
  });

  it("flags short elision stubs that stand in for real code", async () => {
    expect(looksLikePlaceholder("// ...rest of the code unchanged...")).toBe(true);
    expect(looksLikePlaceholder("/* full source here */")).toBe(true);
    expect(looksLikePlaceholder("// your code here")).toBe(true);
  });

  it("does NOT flag real source — even when it mentions bytes or has a long comment", async () => {
    expect(looksLikePlaceholder("export const LEVELS = [{ x: 3038, y: 12 }];")).toBe(false);
    expect(looksLikePlaceholder("const label = `${n} bytes written to disk`; // a real UI string")).toBe(false);
    // A long file that happens to contain an elision-ish phrase deep in a comment
    // is real code, not a stub — the elision check only fires on SHORT content.
    const realFile =
      "export function draw() {\n" + "  ctx.fillRect(0,0,1,1);\n".repeat(30) + "  // rest of the code follows the same pattern\n}";
    expect(looksLikePlaceholder(realFile)).toBe(false);
    expect(looksLikePlaceholder("")).toBe(false);
  });

  it("write_file rejects placeholder content without destroying an existing file", async () => {
    const files = new Map<string, string>();
    files.set("web/src/lib/levels.ts", "export const LEVELS = [1, 2, 3];");
    const result = await executeTool(
      { id: "1", name: "write_file", input: { path: "web/src/lib/levels.ts", content: "[3038 bytes written to web/src/lib/levels.ts]" } },
      files,
      gamesConfig,
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("status message or placeholder");
    // The real file is untouched.
    expect(files.get("web/src/lib/levels.ts")).toBe("export const LEVELS = [1, 2, 3];");
  });

  it("write_file rejects placeholder content on a brand-new file too (nothing gets created)", async () => {
    const files = new Map<string, string>();
    const result = await executeTool(
      { id: "1", name: "write_file", input: { path: "web/src/lib/levels.ts", content: "[3038 bytes written to web/src/lib/levels.ts]" } },
      files,
      gamesConfig,
    );
    expect(result.isError).toBe(true);
    expect(files.has("web/src/lib/levels.ts")).toBe(false);
  });
});

describe("executeTool — write_file storage caps (anti-brick)", () => {
  it("rejects a single file over the per-file byte cap (as a tool error, not a throw)", async () => {
    const files = new Map<string, string>();
    const big = "x".repeat(WRITE_FILE_MAX_BYTES + 1);
    const result = await executeTool({ id: "1", name: "write_file", input: { path: "big.txt", content: big } }, files, appsConfig);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("per-file limit");
    expect(files.has("big.txt")).toBe(false); // not committed
  });

  it("allows a file at exactly the per-file cap", async () => {
    const files = new Map<string, string>();
    const atCap = "x".repeat(WRITE_FILE_MAX_BYTES);
    const result = await executeTool({ id: "1", name: "write_file", input: { path: "ok.txt", content: atCap } }, files, appsConfig);
    expect(result.isError).toBeUndefined();
    expect(files.get("ok.txt")).toBe(atCap);
  });

  it("rejects a new file once the file-count cap is reached", async () => {
    const files = new Map<string, string>();
    for (let i = 0; i < WRITE_FILE_MAX_FILES; i++) files.set(`f${i}.txt`, "a");
    const result = await executeTool({ id: "1", name: "write_file", input: { path: "one-too-many.txt", content: "a" } }, files, appsConfig);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("max");
    // But OVERWRITING an existing file (not adding) is still allowed at the cap.
    const overwrite = await executeTool({ id: "2", name: "write_file", input: { path: "f0.txt", content: "b" } }, files, appsConfig);
    expect(overwrite.isError).toBeUndefined();
    expect(files.get("f0.txt")).toBe("b");
  });

  it("rejects a write that would push the project over the total-bytes cap", async () => {
    const files = new Map<string, string>();
    // Fill close to the total with a few large-but-legal files.
    const chunk = "y".repeat(WRITE_FILE_MAX_BYTES);
    let i = 0;
    while ((i + 1) * WRITE_FILE_MAX_BYTES <= WRITE_FILE_MAX_TOTAL_BYTES) {
      files.set(`chunk${i}.txt`, chunk);
      i++;
    }
    const result = await executeTool({ id: "1", name: "write_file", input: { path: "overflow.txt", content: chunk } }, files, appsConfig);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("total limit");
  });

  it("still writes normal-sized files", async () => {
    const files = new Map<string, string>();
    const result = await executeTool(
      { id: "1", name: "write_file", input: { path: "web/src/App.tsx", content: "export default () => null;" } },
      files,
      appsConfig,
    );
    expect(result.content).toContain("Wrote web/src/App.tsx");
    expect(files.has("web/src/App.tsx")).toBe(true);
  });
});

describe("run_compliance_check (canonical @freegamestore/compliance)", () => {
  // Real FGS games are SDK-based (pathB scaffolds from a fetched seed, so
  // isGameProject=true). The embedded getTemplateFiles base hand-rolls a local
  // GameShell without the SDK marker, so mark the fixture like a production
  // scaffold — otherwise checkBrandTokens auto-detects it as an app.
  function gameFixture(): Map<string, string> {
    const files = new Map(Object.entries(getTemplateFiles(gamesConfig)));
    const wpkg = JSON.parse(files.get("web/package.json")!);
    wpkg.dependencies["@freegamestore/games"] = "^0.14.0";
    files.set("web/package.json", JSON.stringify(wpkg, null, 2));
    return files;
  }

  it("a compliant game passes the canonical gate (0 fails)", async () => {
    const result = await executeTool({ id: "1", name: "run_compliance_check", input: {} }, gameFixture(), gamesConfig);
    expect(result.content).toContain("PASS: MIT License");
    expect(result.content).toContain("PASS: Brand fonts present");
    expect(result.content).toContain("PASS: Brand tokens defined");
    expect(result.content).toContain("PASS: No scroll (games only)");
    expect(result.content).toContain("PASS: PWA meta tags");
    expect(result.content).toContain("PASS: HTML meta tags");
    expect(result.content).toContain("0 fail");
    expect(result.content).toContain("OK to deploy");
  });

  it("surfaces APPNAME placeholders as a NOTE, never a FAIL (platform substitutes at deploy)", async () => {
    const result = await executeTool({ id: "1", name: "run_compliance_check", input: {} }, gameFixture(), gamesConfig);
    expect(result.content).toContain("NOTE: No template placeholders");
    expect(result.content).not.toContain("FAIL: No template placeholders");
  });

  it("treats a missing/platform-managed manifest as a NOTE, not a FAIL", async () => {
    // Repro of the beat-star case: the agent's editable file set doesn't include
    // web/public/manifest.json (a platform-scaffolded file). It must not be a hard
    // FAIL the agent has to hand-wave every build.
    const files = gameFixture();
    files.delete("web/public/manifest.json");
    const result = await executeTool({ id: "1", name: "run_compliance_check", input: {} }, files, gamesConfig);
    expect(result.content).toContain("NOTE: PWA manifest");
    expect(result.content).not.toContain("FAIL: PWA manifest");
  });

  it("passes No-scroll when the layout lock is in a Shell component, not index.css (pixi/babylon/excalibur/littlejs)", async () => {
    // These engines lock layout in a component (100svh + overflow-hidden, and they
    // import the SDK) rather than in index.css. Canonical checkNoScroll recognizes
    // the lock — the hand-rolled false-fail that made the agent rabbit-hole is gone.
    const files = new Map<string, string>([
      [
        "web/index.html",
        `<html lang="en"><head><meta name="viewport" content="width=device-width, user-scalable=no" /><title>G</title></head></html>`,
      ],
      ["web/src/index.css", ":root { --bg:#000; --ink:#fff; --accent:#0f0; }"],
      [
        "web/src/components/Shell.tsx",
        `import "@freegamestore/games"; export function Shell({children}){ return <div style={{height:"100svh"}} className="overflow-hidden">{children}</div>; }`,
      ],
    ]);
    const result = await executeTool({ id: "1", name: "run_compliance_check", input: {} }, files, gamesConfig);
    expect(result.content).toContain("PASS: No scroll (games only)");
    expect(result.content).not.toContain("FAIL: No scroll");
  });

  it("FAILs a game that genuinely scrolls and lacks a license", async () => {
    const files = new Map<string, string>([
      ["web/index.html", `<html lang="en"><head><meta name="viewport" content="width=device-width" /><title>G</title></head></html>`],
      ["web/src/index.css", "body { overflow: auto; min-height: 200vh; } :root { --bg:#000; --ink:#fff; --accent:#0f0; }"],
      ["web/package.json", JSON.stringify({ dependencies: { "@freegamestore/games": "^0.14.0" } })],
    ]);
    const result = await executeTool({ id: "1", name: "run_compliance_check", input: {} }, files, gamesConfig);
    expect(result.content).toContain("FAIL:");
    expect(result.content).toContain("fix the FAILs, then deploy");
  });
});

// The two tool behaviors that stalled the agent on angrry: read results getting
// starved, and multi-term searches silently matching nothing. Lock both down.
describe("clampToolResultForHistory (read must not be starved)", () => {
  it("gives read_file a big budget — a whole ~15KB game file survives intact", async () => {
    const file = "x".repeat(15_000); // a real 300-500 line game file
    const out = clampToolResultForHistory("read_file", file);
    expect(out).toBe(file); // NOT truncated — this was the "file got cut off" bug
    expect(out.length).toBe(15_000);
  });

  it("truncates an over-cap read_file with a recovery note", async () => {
    const huge = "y".repeat(READ_FILE_HISTORY_CAP + 5_000);
    const out = clampToolResultForHistory("read_file", huge);
    expect(out.length).toBeLessThan(huge.length);
    expect(out.startsWith("y".repeat(READ_FILE_HISTORY_CAP))).toBe(true);
    expect(out).toContain("truncated");
    expect(out).toMatch(/read a specific section|split/i);
  });

  it("keeps non-read tools tight (search/list can't flood context)", async () => {
    const big = "z".repeat(DEFAULT_TOOL_HISTORY_CAP + 1_000);
    const out = clampToolResultForHistory("search_files", big);
    expect(out.length).toBeLessThan(big.length);
    expect(out).toContain("truncated");
    // read_file's budget is far larger than everything else.
    expect(READ_FILE_HISTORY_CAP).toBeGreaterThan(DEFAULT_TOOL_HISTORY_CAP * 5);
  });

  it("leaves small results untouched (no spurious note)", async () => {
    expect(clampToolResultForHistory("read_file", "short")).toBe("short");
    expect(clampToolResultForHistory("list_files", "a.ts\nb.ts")).toBe("a.ts\nb.ts");
    expect(clampToolResultForHistory("read_file", "")).toBe("");
  });
});

describe("executeTool — search_files (alternation + robustness)", () => {
  const files = () =>
    new Map<string, string>([
      ["web/src/App.tsx", "const w = canvasSize.w;\nconst h = canvasSize.h;\nwindow.innerWidth;\nuseEffect(() => {});\nplain text line"],
      ["web/src/lib/physics.ts", "export const GRAVITY = 800;\nfunction resize() {}"],
    ]);

  it("matches ANY term for a|b (single call across multiple terms)", async () => {
    const r = await executeTool({ id: "1", name: "search_files", input: { pattern: "innerWidth|GRAVITY|resize" } }, files(), gamesConfig);
    expect(r.content).toContain("App.tsx:3:");
    expect(r.content).toContain("physics.ts:1:");
    expect(r.content).toContain("physics.ts:2:");
    expect(r.content).not.toContain("plain text line");
  });

  it("handles grep-BRE alternation a\\|b (what the model actually emits)", async () => {
    // This is the exact form from the angrry transcript that matched NOTHING.
    const r = await executeTool(
      { id: "1", name: "search_files", input: { pattern: "innerWidth\\|innerHeight\\|resize\\|observer" } },
      files(),
      gamesConfig,
    );
    expect(r.isError).toBeFalsy();
    expect(r.content).toContain("App.tsx:3:"); // innerWidth
    expect(r.content).toContain("physics.ts:2:"); // resize
  });

  it("tolerates whitespace around the pipe", async () => {
    const r = await executeTool({ id: "1", name: "search_files", input: { pattern: "const w = | const h =" } }, files(), gamesConfig);
    expect(r.content).toContain("App.tsx:1:");
    expect(r.content).toContain("App.tsx:2:");
  });

  it("is case-insensitive", async () => {
    const r = await executeTool({ id: "1", name: "search_files", input: { pattern: "GRAVITY|useeffect" } }, files(), gamesConfig);
    expect(r.content).toContain("physics.ts:1:");
    expect(r.content).toContain("App.tsx:4:");
  });

  it("single-term search still works (no false alternation)", async () => {
    const r = await executeTool({ id: "1", name: "search_files", input: { pattern: "canvasSize" } }, files(), gamesConfig);
    expect(r.content).toContain("App.tsx:1:");
    expect(r.content).toContain("App.tsx:2:");
  });

  it("reports no matches (not an error) with the original pattern", async () => {
    const r = await executeTool({ id: "1", name: "search_files", input: { pattern: "nonexistent|alsomissing" } }, files(), gamesConfig);
    expect(r.isError).toBeFalsy();
    expect(r.content).toContain("No matches");
  });

  it("errors on an empty pattern", async () => {
    const r = await executeTool({ id: "1", name: "search_files", input: { pattern: "  " } }, files(), gamesConfig);
    expect(r.isError).toBe(true);
  });

  it("caps output at 50 matches", async () => {
    const big = new Map<string, string>([["big.ts", Array.from({ length: 200 }, (_, i) => `line ${i} hit`).join("\n")]]);
    const r = await executeTool({ id: "1", name: "search_files", input: { pattern: "hit" } }, big, gamesConfig);
    expect(r.content.split("\n").length).toBeLessThanOrEqual(50);
  });

  it("advertises alternation in the tool description so the model uses it", async () => {
    const def = getToolDefinitions(gamesConfig).find((t) => t.name === "search_files")!;
    expect(def.description.toLowerCase()).toContain("alternation");
    expect(def.description).toContain("|");
  });
});

describe("validateImports — type-only syntax", () => {
  const project = new Map<string, string>([
    [
      "web/src/types.ts",
      `export interface GameState { score: number }\nexport type Tile = { id: number }\ninterface Hidden {}\nexport type { Hidden }\n`,
    ],
    ["web/src/game.ts", `export function tick() {}\n`],
  ]);

  it("does not treat the `type` keyword as a default import", async () => {
    const w = validateImports("web/src/App.tsx", `import type { GameState, Tile } from "./types";\n`, project);
    expect(w).toBe("");
  });

  it("accepts names re-exported via `export type { ... }`", async () => {
    const w = validateImports("web/src/App.tsx", `import { Hidden } from "./types";\n`, project);
    expect(w).toBe("");
  });

  it("still flags a genuinely missing named export", async () => {
    const w = validateImports("web/src/App.tsx", `import { missingThing } from "./game";\n`, project);
    expect(w).toContain('does not export "missingThing"');
  });

  it("still flags a default import of a module with no default export", async () => {
    const w = validateImports("web/src/App.tsx", `import game from "./game";\n`, project);
    expect(w).toContain("no default export");
  });
});
