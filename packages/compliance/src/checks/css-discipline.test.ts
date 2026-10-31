import { describe, expect, it } from 'vitest';
import { mapFileSource } from '../lib/file-source.js';
import { checkCssDiscipline } from './css-discipline.js';

const run = (css: string) =>
  checkCssDiscipline(mapFileSource(new Map([['web/src/index.css', css]])));

// platform#396: five rules, each with a passing and a failing fixture. All warn.

const CLEAN = `@import "tailwindcss";
@theme inline { --color-ink: var(--ink); }
:root { --paper: #ffffff; --ink: #111111; --accent: #10b981; }
@media (prefers-color-scheme: dark) { :root { --paper: #000000; --ink: #f5f5f5; } }
@layer base { body { margin: 0; background: var(--paper); } }
`;

describe('checkCssDiscipline (#396)', () => {
  it('passes tokens + @theme + @layer base', async () => {
    expect((await run(CLEAN)).status).toBe('pass');
  });

  it('passes a project with no CSS at all', async () => {
    expect((await checkCssDiscipline(mapFileSource(new Map()))).status).toBe('pass');
  });

  describe('banned-alias', () => {
    it('warns on a declared retired alias', async () => {
      const r = await run(':root { --error: #c74f43; --paper: #fff; }');
      expect(r.status).toBe('warn');
      expect(r.detail).toMatch(/banned-alias 1/);
      expect(r.detail).toMatch(/--error/);
    });
    it('warns on var() use of a retired alias', async () => {
      const r = await run('@layer base { a { color: var(--surface, red); } }');
      expect(r.detail).toMatch(/banned-alias/);
    });
    it('does not ban --bg (the brand-tokens check needs it)', async () => {
      expect((await run(':root { --bg: #fff; --ink: #111; --accent: #0a0; }')).status).toBe('pass');
    });
  });

  describe('unlayered-rule', () => {
    it('warns on a rule outside @layer', async () => {
      const r = await run('body { margin: 0; }');
      expect(r.status).toBe('warn');
      expect(r.detail).toMatch(/unlayered-rule 1/);
    });
    it('passes the same rule inside @layer base', async () => {
      expect((await run('@layer base { body { margin: 0; } }')).status).toBe('pass');
    });
    it('passes :root[data-theme] token blocks outside @layer', async () => {
      expect((await run(':root[data-theme="dark"] { --paper: #000; --ink: #fff; }')).status).toBe(
        'pass',
      );
    });
  });

  describe('hex-outside-tokens', () => {
    it('warns on a hex colour in a normal rule', async () => {
      const r = await run('@layer base { a { color: #ff0000; } }');
      expect(r.status).toBe('warn');
      expect(r.detail).toMatch(/hex-outside-tokens 1/);
    });
    it('allows hex in :root token blocks and @theme', async () => {
      expect(
        (await run(':root { --paper: #fff; }\n@theme { --color-brand: #ff0000; }')).status,
      ).toBe('pass');
    });
    it('passes a rule that uses tokens', async () => {
      expect((await run('@layer base { a { color: var(--accent); } }')).status).toBe('pass');
    });
  });

  describe('per-screen-dark-override', () => {
    it('warns on a component rule inside the dark media query', async () => {
      const r = await run(
        '@layer base { @media (prefers-color-scheme: dark) { .card { color: white; } } }',
      );
      expect(r.detail).toMatch(/per-screen-dark-override 1/);
    });
    it('warns on a .dark descendant selector', async () => {
      const r = await run('@layer base { .dark nav { color: white; } }');
      expect(r.detail).toMatch(/per-screen-dark-override/);
    });
    it('allows redefining tokens in a dark :root block', async () => {
      expect(
        (await run('@media (prefers-color-scheme: dark) { :root { --paper: #000; --ink: #fff; } }'))
          .status,
      ).toBe('pass');
    });
  });

  describe('feature-classes', () => {
    it('warns on a class selector in @layer components', async () => {
      const r = await run('@layer components { .score-badge { padding: 4px; } }');
      expect(r.status).toBe('warn');
      expect(r.detail).toMatch(/feature-classes 1/);
    });
    it('allows element selectors in @layer base', async () => {
      expect((await run('@layer base { h1, h2 { font-weight: 800; } }')).status).toBe('pass');
    });
    it('does not mistake attribute strings for classes', async () => {
      expect((await run('@layer base { a[href$=".pdf"]:hover { color: inherit; } }')).status).toBe(
        'pass',
      );
    });
  });

  it('reports several rules at once with a suggestion for each', async () => {
    const r = await run('.badge { color: #f00; }\n:root { --glass: #fff; }');
    expect(r.status).toBe('warn');
    expect(r.detail).toMatch(/banned-alias 1/);
    expect(r.detail).toMatch(/unlayered-rule 1/);
    expect(r.detail).toMatch(/hex-outside-tokens 1/);
    expect(r.detail).toMatch(/feature-classes 1/);
    expect(r.suggestions?.length).toBe(4);
  });
});
