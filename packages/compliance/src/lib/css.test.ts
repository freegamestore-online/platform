import { describe, expect, it } from 'vitest';
import { colorAlpha, parseCss } from './css.js';

describe('parseCss', () => {
  it('reads selectors, declarations and line numbers', () => {
    const rules = parseCss(':root {\n  --a: #fff;\n  --b: 1px;\n}\n\n.x { color: red }');
    expect(rules).toHaveLength(2);
    expect(rules[0]).toMatchObject({ selector: ':root', atRules: [], line: 1 });
    expect(rules[0]?.decls).toEqual([
      { prop: '--a', value: '#fff', line: 2 },
      { prop: '--b', value: '1px', line: 3 },
    ]);
    expect(rules[1]).toMatchObject({ selector: '.x', line: 6 });
  });

  it('tracks enclosing at-rules and reads @theme as a declaration block', () => {
    const rules = parseCss(
      '@import "tailwindcss";\n@layer base { body { margin: 0 } }\n@media (prefers-color-scheme: dark) { :root { --a: red } }\n@theme inline { --color-ink: var(--ink); }',
    );
    expect(rules.map((r) => [r.selector, r.atRules])).toEqual([
      ['body', ['@layer base']],
      [':root', ['@media (prefers-color-scheme: dark)']],
      ['@theme inline', []],
    ]);
    expect(rules[2]?.decls[0]).toMatchObject({ prop: '--color-ink', value: 'var(--ink)' });
  });

  it('ignores comments, strings with braces and @keyframes', () => {
    const rules = parseCss(
      '/* .ghost { color: red } */\n.a::after { content: "}{;" }\n@keyframes spin { from { opacity: 0 } to { opacity: 1 } }\n.b { color: blue }',
    );
    expect(rules.map((r) => r.selector)).toEqual(['.a::after', '.b']);
    expect(rules[0]?.decls[0]?.value).toBe('"}{;"');
    expect(rules[1]?.line).toBe(4);
  });
});

describe('colorAlpha', () => {
  it.each([
    ['#fff', 1],
    ['#ffffff', 1],
    ['#ffffff80', 128 / 255],
    ['#fff8', 136 / 255],
    ['rgb(0, 0, 0)', 1],
    ['rgba(255, 255, 255, 0.72)', 0.72],
    ['rgba(0,0,0,1)', 1],
    ['rgb(0 0 0 / 50%)', 0.5],
    ['hsl(0 0% 0% / 0.2)', 0.2],
    ['hsla(0, 0%, 0%, 0.4)', 0.4],
    ['transparent', 0],
    ['color-mix(in srgb, red 50%, transparent)', 0],
  ])('%s -> %s', (value, alpha) => {
    expect(colorAlpha(value)).toBeCloseTo(alpha, 5);
  });

  it('returns null for values it cannot resolve', () => {
    expect(colorAlpha('var(--x)')).toBeNull();
    expect(colorAlpha('linear-gradient(red, blue)')).toBeNull();
  });
});
