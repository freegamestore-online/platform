import { describe, expect, it } from "vitest";
import { getConfig } from "./config";
import { gameSourceDelta, substituteAppName } from "./deploy";
import { getTemplateFiles } from "./template";

const games = getConfig("games");

/** Simulate the agent's session.files at deploy time: the template scaffold with
 *  APPNAME substituted (as infra-exec does), plus whatever the agent edited. */
function sessionFiles(appId: string, appName: string, edits: Record<string, string> = {}): Map<string, string> {
  const files = new Map(Object.entries(getTemplateFiles(games)));
  substituteAppName(files, appId, appName);
  for (const [path, content] of Object.entries(edits)) files.set(path, content);
  return files;
}

describe("gameSourceDelta — only the agent's authored files", () => {
  it("returns EMPTY when the agent changed nothing beyond the scaffold", () => {
    const files = sessionFiles("snake", "Snake");
    const delta = gameSourceDelta(files, games, "snake", "Snake");
    expect(delta.size).toBe(0);
  });

  it("includes an edited game file but excludes untouched scaffold", () => {
    const files = sessionFiles("snake", "Snake", {
      "web/src/App.tsx": "export default function App() { return <div>SNAKE!</div>; }",
    });
    const delta = gameSourceDelta(files, games, "snake", "Snake");
    expect([...delta.keys()]).toEqual(["web/src/App.tsx"]);
    // Scaffold files admin owns must NOT be in the delta.
    expect(delta.has("package.json")).toBe(false);
    expect(delta.has(".github/workflows/deploy.yml")).toBe(false);
    expect(delta.has("web/package.json")).toBe(false);
  });

  it("includes brand-new files the agent added", () => {
    const files = sessionFiles("snake", "Snake", {
      "web/src/game/loop.ts": "export const tick = () => {};",
    });
    const delta = gameSourceDelta(files, games, "snake", "Snake");
    expect(delta.has("web/src/game/loop.ts")).toBe(true);
    expect(delta.size).toBe(1);
  });

  it("includes package.json only if the agent actually changed it (e.g. added a dep)", () => {
    const base = sessionFiles("snake", "Snake");
    const pkg = base.get("package.json")!;
    const files = sessionFiles("snake", "Snake", { "package.json": pkg.replace(/"private": true/, '"private": true, "type": "module"') });
    const delta = gameSourceDelta(files, games, "snake", "Snake");
    expect(delta.has("package.json")).toBe(true);
  });
});

describe("substituteAppName", () => {
  it('uses the slug in canonical/OG URLs and the display name in metadata', () => {
    const files = new Map([['web/index.html', '<link rel="canonical" href="https://APPNAME.freegamestore.online/"><meta property="og:title" content="APPNAME">']]);
    substituteAppName(files, 'my-game', 'My Game');
    expect(files.get('web/index.html')).toContain('https://my-game.freegamestore.online/');
    expect(files.get('web/index.html')).toContain('content="My Game"');
  });
  it('escapes display names in HTML metadata attributes', () => {
    const files = new Map([['web/index.html', '<meta property="og:title" content="APPNAME">']]);
    substituteAppName(files, 'safe-game', 'A "game" <&>');
    expect(files.get('web/index.html')).toBe('<meta property="og:title" content="A &quot;game&quot; &lt;&amp;&gt;">');
  });
  it("uses the slug in package manifests and the display name elsewhere", () => {
    const files = new Map<string, string>([
      ["package.json", `{"name":"APPNAME"}`],
      ["web/index.html", `<title>APPNAME — FreeGameStore</title>`],
    ]);
    substituteAppName(files, "my-game", "My Game");
    expect(files.get("package.json")).toBe(`{"name":"my-game"}`);
    expect(files.get("web/index.html")).toBe(`<title>My Game — FreeGameStore</title>`);
  });

  it("in index.html, rewrites the analytics slug (app=APPNAME) to the ID, and the title to the display name", () => {
    // Matches admin's rule exactly. A blanket APPNAME→display-name replace would
    // push `app=My Game` into the analytics loader and break attribution.
    const files = new Map<string, string>([
      ["web/index.html", `<title>APPNAME — FreeGameStore</title>\n<script src="/v1/analytics.js?app=APPNAME"></script>`],
    ]);
    substituteAppName(files, "my-game", "My Game");
    const html = files.get("web/index.html")!;
    expect(html).toContain("app=my-game"); // analytics slug → the ID
    expect(html).not.toContain("app=My Game");
    expect(html).toContain("<title>My Game — FreeGameStore</title>"); // title → display name
  });

  it("does not corrupt a display name containing regex replacement tokens ($&)", () => {
    const files = new Map<string, string>([["web/src/App.tsx", `<h1>APPNAME</h1>`]]);
    substituteAppName(files, "cash", "Cash $& Co");
    expect(files.get("web/src/App.tsx")).toBe(`<h1>Cash $& Co</h1>`);
  });
});
