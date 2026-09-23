import { describe, expect, it } from "vitest";
import { checkBuildSanity, stripToSkeleton } from "./build-sanity";

const f = (path: string, content: string) => new Map([[path, content]]);

describe("stripToSkeleton — hides embedded code, never invents column-0 code", () => {
  it("blanks line & block comment bodies", () => {
    const sk = stripToSkeleton(`// function ghost() {}\n/* function ghost2() {} */\nconst x = 1;`);
    expect(sk).not.toContain("ghost");
    expect(sk).toContain("const x");
  });

  it("blanks template-literal bodies (even multi-line, code-looking)", () => {
    const sk = stripToSkeleton("const t = `\nfunction ghost() {}\n`;\nconst real = 2;");
    expect(sk).not.toContain("ghost");
    expect(sk).toContain("const real");
  });

  it("auto-closes an unterminated quote at newline (JSX apostrophe safety)", () => {
    // The apostrophe in "Don't" must NOT swallow the following lines.
    const sk = stripToSkeleton(`<h1>Don't stop</h1>\nconst score = 1;`);
    expect(sk).toContain("const score");
  });

  it("preserves line structure (column-0 anchors survive)", () => {
    const src = `const a = 1;\n  const b = 2;\nfunction c() {}`;
    const sk = stripToSkeleton(src);
    expect(sk.split("\n")).toHaveLength(3);
    expect(/^const a/m.test(sk)).toBe(true);
    expect(/^\s+const b/m.test(sk)).toBe(true);
  });
});

describe("checkBuildSanity — duplicate top-level declarations (the incident)", () => {
  it("flags a duplicated top-level function (climberadventure pattern)", () => {
    const src = `
function getPlatformColor(i) { return i; }
function drawMountainBg(ctx) { ctx.fill(); }
function lerp(a, b, t) { return a + (b - a) * t; }

// ...appended a second copy instead of replacing...
function getPlatformColor(i) { return i; }
function drawMountainBg(ctx) { ctx.fill(); }
function lerp(a, b, t) { return a + (b - a) * t; }
`;
    const findings = checkBuildSanity(f("web/src/App.tsx", src));
    expect(findings).toHaveLength(1);
    expect(findings[0].problem).toContain("getPlatformColor");
    expect(findings[0].problem).toContain("drawMountainBg");
    expect(findings[0].problem).toContain("lerp");
  });

  it("flags a duplicated top-level const", () => {
    const findings = checkBuildSanity(f("web/src/game.ts", `const GRAVITY = 9.8;\nconst GRAVITY = 9.8;`));
    expect(findings.some((x) => x.problem.includes("GRAVITY"))).toBe(true);
  });

  it("does NOT flag same name at different scopes (indented)", () => {
    const src = `function a() {
  const x = 1;
  return x;
}
function b() {
  const x = 2;
  return x;
}`;
    expect(checkBuildSanity(f("web/src/App.tsx", src))).toHaveLength(0);
  });

  it("does NOT flag a name that only appears in strings/comments/templates", () => {
    const src = `const draw = () => {};\n// function draw() {}\nconst note = "function draw() {}";\nconst tpl = \`\nfunction draw(){}\n\`;`;
    expect(checkBuildSanity(f("web/src/App.tsx", src))).toHaveLength(0);
  });
});

describe("checkBuildSanity — multiple default exports", () => {
  it("flags two default exports", () => {
    const src = `export default function A() { return null; }\nexport default function B() { return null; }`;
    const findings = checkBuildSanity(f("web/src/App.tsx", src));
    expect(findings.some((x) => x.problem.includes("export default"))).toBe(true);
  });
});

describe("checkBuildSanity — Pixi runtime hazards", () => {
  it("blocks RGBA-packed Pixi colors before they ship", () => {
    const files = new Map([
      ["web/package.json", JSON.stringify({ dependencies: { "pixi.js": "^8.0.0" } })],
      [
        "web/src/App.tsx",
        `import { Graphics } from "pixi.js";

const g = new Graphics();
g.rect(0, 0, 10, 10).stroke({ color: 0x8b691466, width: 1 });
`,
      ],
    ]);

    const findings = checkBuildSanity(files);
    expect(findings.some((x) => x.problem.includes("0x8b691466"))).toBe(true);
    expect(findings.some((x) => x.problem.includes("alpha"))).toBe(true);
  });

  it("allows normal Pixi RGB colors with a separate alpha field", () => {
    const files = new Map([
      ["web/package.json", JSON.stringify({ dependencies: { "pixi.js": "^8.0.0" } })],
      [
        "web/src/App.tsx",
        `import { Graphics } from "pixi.js";

const g = new Graphics();
g.rect(0, 0, 10, 10).stroke({ color: 0x8b6914, alpha: 0.4, width: 1 });
g.circle(5, 5, 3).fill({ color: 0xffffff, alpha: 0.5 });
`,
      ],
    ]);

    expect(checkBuildSanity(files)).toHaveLength(0);
  });

  it("does not apply the Pixi color rule to non-Pixi projects", () => {
    const findings = checkBuildSanity(f("web/src/App.tsx", `const mask = 0x8b691466;`));
    expect(findings).toHaveLength(0);
  });
});

describe("checkBuildSanity — KAPLAY build hazards", () => {
  it("blocks the invalid @freegamestore/games/kaplay import", () => {
    const files = new Map([
      ["web/package.json", JSON.stringify({ dependencies: { kaplay: "^3001.0.19" } })],
      ["web/src/game.ts", `import k from "@freegamestore/games/kaplay";\nexport function startGame() { k.setCanvas(canvas); }`],
    ]);

    const findings = checkBuildSanity(files);
    expect(findings.some((x) => x.problem.includes("@freegamestore/games does not export ./kaplay"))).toBe(true);
    expect(findings.some((x) => x.problem.includes('import kaplay from "kaplay"'))).toBe(true);
  });

  it("blocks malformed one-line k.text template literals", () => {
    const files = new Map([
      ["web/package.json", JSON.stringify({ dependencies: { kaplay: "^3001.0.19" } })],
      ["web/src/game.ts", `k.add([\n  k.text(\`Score: \${score}", { size: 24 }),\n]);`],
    ]);

    const findings = checkBuildSanity(files);
    expect(findings.some((x) => x.problem.includes("likely unterminated template literal"))).toBe(true);
    expect(findings.some((x) => x.problem.includes("line 2"))).toBe(true);
  });

  it("allows valid one-line k.text template literals", () => {
    const files = new Map([
      ["web/package.json", JSON.stringify({ dependencies: { kaplay: "^3001.0.19" } })],
      ["web/src/game.ts", "k.add([k.text(`Score: ${score}`, { size: 24 })]);"],
    ]);

    expect(checkBuildSanity(files)).toHaveLength(0);
  });
});

// The candy-shop failure (2026-08-09): KAPLAY parses [name]…[/name] as styled
// text, so bare bracket labels threw "Styled text error: unclosed tags G,C,H" at
// runtime while tsc and vite build both passed.
describe("checkBuildSanity — KAPLAY unclosed styled-text tags", () => {
  const kaplayFiles = (game: string) =>
    new Map([
      ["web/package.json", JSON.stringify({ dependencies: { kaplay: "^3001.0.19" } })],
      ["web/src/game.ts", game],
    ]);

  it("blocks the candy-shop pattern and names every unclosed tag", () => {
    const findings = checkBuildSanity(kaplayFiles(`k.add([\n  k.text("[G] Gummies   [C] Chocolates   [H] Hard", { size: 18 }),\n]);`));
    const styled = findings.find((x) => x.problem.includes("unclosed styled-text tag"));
    expect(styled).toBeDefined();
    expect(styled?.problem).toContain("[G], [C], [H]");
    expect(styled?.problem).toContain("line 2");
    // The message must explain the escape, not just report the fault.
    expect(styled?.problem).toContain("escape");
  });

  it("allows a balanced [red]…[/red] pair", () => {
    expect(checkBuildSanity(kaplayFiles(`k.text("[red]Score[/red]: 0", { size: 24 });`))).toHaveLength(0);
  });

  it("flags a bracket key hint — KAPLAY would throw on it too", () => {
    const findings = checkBuildSanity(kaplayFiles(`k.text("Press [Enter] to start");`));
    expect(findings.some((x) => x.problem.includes("[Enter]"))).toBe(true);
  });

  it("stays silent on an interpolated index — an interpolated [0] is not markup", () => {
    expect(checkBuildSanity(kaplayFiles(`k.text(\`\${items[0]} pts\`, { size: 16 });`))).toHaveLength(0);
  });

  it("stays silent on an escaped bracket", () => {
    expect(checkBuildSanity(kaplayFiles(`k.text("\\\\[G] Gummies");`))).toHaveLength(0);
  });

  it("ignores brackets in the options argument, which KAPLAY never parses", () => {
    expect(checkBuildSanity(kaplayFiles(`k.text("Score", { font: fonts[0], styles: { red: { color: c } } });`))).toHaveLength(0);
  });

  it("does not fire for a non-KAPLAY project using the same string", () => {
    const files = new Map([
      ["web/package.json", JSON.stringify({ dependencies: { "pixi.js": "^8.0.0" } })],
      ["web/src/game.ts", `k.text("[G] Gummies   [C] Chocolates");`],
    ]);
    expect(checkBuildSanity(files)).toHaveLength(0);
  });

  it("reports each offending call separately", () => {
    const findings = checkBuildSanity(kaplayFiles(`k.text("[G] Gummies");\nk.text("[red]ok[/red]");\nk.text("[H] Hard");`));
    const styled = findings.filter((x) => x.problem.includes("unclosed styled-text tag"));
    expect(styled).toHaveLength(2);
    expect(styled[0].problem).toContain("line 1");
    expect(styled[1].problem).toContain("line 3");
  });

  it("handles a k.text call whose string sits on a later line", () => {
    const findings = checkBuildSanity(kaplayFiles(`k.text(\n  "[G] Gummies",\n  { size: 18 },\n);`));
    expect(findings.some((x) => x.problem.includes("[G]"))).toBe(true);
  });

  // The ACTUAL candy-shop shape (f48a74b^): the tags never appear at the call
  // site — they live in a data table that is passed to k.text() a scope away.
  // Scanning only the call's own argument missed the real bug entirely.
  it("catches tags reached indirectly through a data table", () => {
    const game = `const buttons = [
  { cat: "gummy", x: 10, label: "GUM\\n[G]" },
  { cat: "choco", x: 20, label: "CHO\\n[C]" },
];
for (const b of buttons) {
  k.add([k.text(b.label, { size: 14 }), k.pos(b.x, 0)]);
}`;
    const findings = checkBuildSanity(kaplayFiles(game));
    expect(findings.some((x) => x.problem.includes("[G]"))).toBe(true);
    expect(findings.some((x) => x.problem.includes("[C]"))).toBe(true);
  });

  it("does not scan a file that never renders text", () => {
    const files = new Map([
      ["web/package.json", JSON.stringify({ dependencies: { kaplay: "^3001.0.19" } })],
      ["web/src/game.ts", `k.text("ok");`],
      ["web/src/data.ts", `export const KEYS = { g: "[G] Gummies" };`],
    ]);
    expect(checkBuildSanity(files)).toHaveLength(0);
  });

  // Live candy-shop code today. An interpolated index must never block a deploy.
  it("stays silent on the real interpolated-stock pattern shipping in production", () => {
    const game = `k.text(\`\${tier.name}  ×\${gs.stock[cat]}\`, { size: 13, font: "sans-serif" });`;
    expect(checkBuildSanity(kaplayFiles(game))).toHaveLength(0);
  });

  // KAPLAY's own matcher is /^\[(\/)?(\w+?)\]/ — a space or "!" fails it, so
  // "[Type it!]" is plain text and must not be reported.
  it("does not flag a bracket phrase KAPLAY would not parse as a tag", () => {
    expect(checkBuildSanity(kaplayFiles(`k.text("STOP\\n[Type it!]", { size: 14 });`))).toHaveLength(0);
  });

  it("survives a JSX apostrophe without swallowing the file", () => {
    const src = `export function Hud() {\n  return <h1>Don't stop</h1>;\n}\nk.text("[G] Gummies");`;
    const files = new Map([
      ["web/package.json", JSON.stringify({ dependencies: { kaplay: "^3001.0.19" } })],
      ["web/src/Hud.tsx", src],
    ]);
    expect(checkBuildSanity(files).some((x) => x.problem.includes("[G]"))).toBe(true);
  });
});

describe("checkBuildSanity — NO false positives on real-world patterns", () => {
  it("passes JSX with apostrophes, regex, templates, generics, division", () => {
    const src = `import { useState } from "react";

const TILE = 32;
type Cell = { x: number; y: number };
const clean = (s: string) => s.replace(/[^a-z{}]/gi, "");

function neighbors<T extends Cell>(c: T): Cell[] {
  return [{ x: c.x + 1, y: c.y }, { x: c.x - 1, y: c.y }];
}

export default function App() {
  const [score, setScore] = useState(0);
  const rate = score / (TILE || 1);
  return (
    <main>
      <h1>Don't stop — you're winning!</h1>
      <p>It's {neighbors({ x: 0, y: 0 } as Cell).length} moves, rate {rate}</p>
      {score > 0 && <span>Player's best: {clean("a{b}")}</span>}
      <button onClick={() => setScore((s) => s + 1)}>+1</button>
    </main>
  );
}`;
    expect(checkBuildSanity(f("web/src/App.tsx", src))).toHaveLength(0);
  });

  it("only inspects web/src compiled sources", () => {
    const files = new Map([
      ["scripts/tool.ts", `const X = 1;\nconst X = 2;`],
      ["README.md", `function foo(){}\nfunction foo(){}`],
    ]);
    expect(checkBuildSanity(files)).toHaveLength(0);
  });
});
