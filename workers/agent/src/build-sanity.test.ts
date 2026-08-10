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
      ["web/src/App.tsx", `import { Graphics } from "pixi.js";

const g = new Graphics();
g.rect(0, 0, 10, 10).stroke({ color: 0x8b691466, width: 1 });
`],
    ]);

    const findings = checkBuildSanity(files);
    expect(findings.some((x) => x.problem.includes("0x8b691466"))).toBe(true);
    expect(findings.some((x) => x.problem.includes("alpha"))).toBe(true);
  });

  it("allows normal Pixi RGB colors with a separate alpha field", () => {
    const files = new Map([
      ["web/package.json", JSON.stringify({ dependencies: { "pixi.js": "^8.0.0" } })],
      ["web/src/App.tsx", `import { Graphics } from "pixi.js";

const g = new Graphics();
g.rect(0, 0, 10, 10).stroke({ color: 0x8b6914, alpha: 0.4, width: 1 });
g.circle(5, 5, 3).fill({ color: 0xffffff, alpha: 0.5 });
`],
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
