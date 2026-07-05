import { describe, expect, it } from "vitest";
import { checkBuildSanity, scan } from "./build-sanity";

const f = (path: string, content: string) => new Map([[path, content]]);

describe("scan — skeleton & balance (no false positives)", () => {
  it("balances plain code", () => {
    const { brace, paren, bracket } = scan("function f() { const a = [1, 2]; return (a); }");
    expect([brace, paren, bracket]).toEqual([0, 0, 0]);
  });

  it("ignores braces inside strings", () => {
    const { brace } = scan(`const s = "a } b { c"; const t = 'x } y';`);
    expect(brace).toBe(0);
  });

  it("ignores braces inside line & block comments", () => {
    const { brace } = scan(`// a } stray {\n/* another } { here */\nconst x = 1;`);
    expect(brace).toBe(0);
  });

  it("ignores braces inside regex character classes", () => {
    const { brace, bracket } = scan(`const re = /[{}]/g; const m = "hi".match(/\\d{2,3}/);`);
    expect(brace).toBe(0);
    expect(bracket).toBe(0);
  });

  it("handles template literals with interpolation (real braces inside)", () => {
    const src = "const html = `<div class=${cls}>${items.map((x) => `<li>${x}</li>`).join('')}</div>`;";
    const { brace, paren } = scan(src);
    expect(brace).toBe(0);
    expect(paren).toBe(0);
  });

  it("does not treat division as regex", () => {
    const { brace, bracket } = scan(`const r = width / 2; const c = arr[0] / count;`);
    expect(brace).toBe(0);
    expect(bracket).toBe(0);
  });

  it("treats regex after a keyword correctly", () => {
    const { brace } = scan(`function ok(s) { return /[{]/.test(s); }`);
    expect(brace).toBe(0);
  });

  it("survives JSX with expressions and closing tags", () => {
    const src = `export default function App() {
      return (
        <div className="wrap">
          {items.map((it) => <li key={it.id}>{it.name}</li>)}
          <span>{count / total}</span>
        </div>
      );
    }`;
    const { brace, paren } = scan(src);
    expect(brace).toBe(0);
    expect(paren).toBe(0);
  });

  it("detects a genuinely truncated file", () => {
    const { brace } = scan(`function f() { if (x) { doThing();`);
    expect(brace).toBeGreaterThan(0);
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

  it("does NOT flag a name that only appears in strings/comments", () => {
    const src = `const draw = () => {};\n// function draw() {}\nconst note = "function draw() {}";`;
    expect(checkBuildSanity(f("web/src/App.tsx", src))).toHaveLength(0);
  });
});

describe("checkBuildSanity — other blocking failures", () => {
  it("flags multiple default exports", () => {
    const src = `export default function A() { return null; }\nexport default function B() { return null; }`;
    const findings = checkBuildSanity(f("web/src/App.tsx", src));
    expect(findings.some((x) => x.problem.includes("export default"))).toBe(true);
  });

  it("flags unbalanced braces from a truncated component", () => {
    const findings = checkBuildSanity(f("web/src/App.tsx", `export default function App() {\n  return <div>hi</div>;`));
    expect(findings.some((x) => x.problem.includes("curly braces"))).toBe(true);
  });
});

describe("checkBuildSanity — scope & clean passes", () => {
  it("only inspects web/src compiled sources", () => {
    // Duplicate decls in a non-compiled path must be ignored.
    const files = new Map([
      ["scripts/tool.ts", `const X = 1;\nconst X = 2;`],
      ["web/public/data.json", `{ "a": 1 }`],
      ["README.md", `function foo(){}\nfunction foo(){}`],
    ]);
    expect(checkBuildSanity(files)).toHaveLength(0);
  });

  it("passes a realistic clean App.tsx", () => {
    const src = `import { useState } from "react";

const TILE = 32;
type Cell = { x: number; y: number };

function neighbors(c: Cell): Cell[] {
  return [
    { x: c.x + 1, y: c.y },
    { x: c.x - 1, y: c.y },
  ];
}

export default function App() {
  const [score, setScore] = useState(0);
  const label = \`Score: \${score}\`;
  const rate = score / (TILE || 1);
  return (
    <main>
      <h1>{label}</h1>
      <p>{neighbors({ x: 0, y: 0 }).length} moves — rate {rate}</p>
      <button onClick={() => setScore((s) => s + 1)}>+1</button>
    </main>
  );
}`;
    expect(checkBuildSanity(f("web/src/App.tsx", src))).toHaveLength(0);
  });
});
