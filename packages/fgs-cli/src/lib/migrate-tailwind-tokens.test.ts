import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { renderMigrateResult } from '../commands/migrate.js';
import { migrateTailwindTokens } from './migrate-tailwind-tokens.js';

// platform#397 (port of PAS #494): the codemod rewrites long-hand token utilities and
// resolves retired aliases by the app's own definition. Dry run by default; idempotent.

const made: string[] = [];
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

const TOKENS = `  --paper: #fafafa;
  --ink: #111;
  --muted: #666;
  --line: #ddd;
  --panel: #f9fafb;
  --accent: #2563eb;
`;
const INDEX = `@import "tailwindcss";
@source "../node_modules/@freegamestore/games/dist";

:root {
${TOKENS}}
`;

/** A game repo with the given files under web/src. */
function game(files: Record<string, string>, base = ''): string {
  const dir = mkdtempSync(join(tmpdir(), 'fgs-migrate-'));
  made.push(dir);
  for (const [f, c] of Object.entries(files)) {
    const full = join(dir, base, 'web/src', f);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, c);
  }
  return dir;
}
const read = (dir: string, f: string, base = '') =>
  readFileSync(join(dir, base, 'web/src', f), 'utf8');
/** Everything `INDEX` has, with one extra declaration in `:root`. */
const withRoot = (decl: string) => INDEX.replace('}\n', `${decl}\n}\n`);

describe('fgs migrate tailwind-tokens (#397)', () => {
  it('rewrites long-hand utilities, keeping variants and opacity, and inserts @theme inline', async () => {
    const dir = game({
      'index.css': INDEX,
      'A.tsx':
        'export const A = () => <div className="hover:text-[var(--muted)] md:border-[var(--line)]/50 bg-[var(--paper)] dark:border-t-[var(--line)]" />;',
    });
    const r = await migrateTailwindTokens({ dir, write: true });
    expect(read(dir, 'A.tsx')).toContain(
      'className="hover:text-muted md:border-line/50 bg-paper dark:border-t-line"',
    );
    expect(r.themeInserted).toBe(true);
    const css = read(dir, 'index.css');
    expect(css).toMatch(/@source [^\n]+\n\n@theme inline \{\n {2}--color-paper: var\(--paper\);/);
    expect(css).toContain('--color-panel: var(--panel);');
    // Only tokens the app defines are mapped.
    expect(css).not.toContain('--color-danger');
    expect(css).not.toContain('--color-success');
  });

  it('inserts the theme block after @import when there is no @source', async () => {
    const dir = game({ 'index.css': INDEX.replace(/@source[^\n]*\n/, '') });
    await migrateTailwindTokens({ dir, write: true });
    expect(read(dir, 'index.css')).toMatch(/^@import "tailwindcss";\n\n@theme inline \{/);
  });

  it('leaves an unknown token unchanged and reports it', async () => {
    const dir = game({
      'index.css': INDEX,
      'A.tsx': 'const c = "text-[var(--unknown)] text-[var(--ink)]";',
    });
    const r = await migrateTailwindTokens({ dir, write: true });
    expect(read(dir, 'A.tsx')).toBe('const c = "text-[var(--unknown)] text-ink";');
    expect(r.unknownTokens).toEqual({ '--unknown': 1 });
    expect(r.report.join('\n')).toContain('--unknown');
  });

  it('leaves a mapped token the app does not define, and no longer maps rounded/shadow', async () => {
    const dir = game({
      'index.css': INDEX,
      'A.tsx': 'const c = "text-[var(--danger)] rounded-[var(--radius)] shadow-[var(--shadow)]";',
    });
    await migrateTailwindTokens({ dir, write: true });
    expect(read(dir, 'A.tsx')).toBe(
      'const c = "text-[var(--danger)] rounded-[var(--radius)] shadow-[var(--shadow)]";',
    );
  });

  it('does not touch a bare arbitrary value, CSS-in-JS, or a longer token', async () => {
    const src =
      "const a = '[var(--ink)]'; const s = { color: 'var(--ink)' }; const t = 'x-text-[var(--ink)]';";
    const dir = game({ 'index.css': INDEX, 'A.tsx': src });
    await migrateTailwindTokens({ dir, write: true });
    expect(read(dir, 'A.tsx')).toBe(src);
  });

  it("inlines a retired alias by the app's own definition and deletes it", async () => {
    const dir = game({
      'index.css': `${withRoot('  --surface: var(--paper);')}.x { background: var(--surface); }\n`,
      'A.tsx': 'const c = "bg-[var(--surface)]";',
    });
    const r = await migrateTailwindTokens({ dir, write: true });
    const css = read(dir, 'index.css');
    expect(css).not.toContain('--surface');
    expect(css).toContain('background: var(--paper);');
    expect(read(dir, 'A.tsx')).toBe('const c = "bg-paper";');
    expect(r.inlinedAliases).toEqual([{ alias: '--surface', target: '--paper' }]);
  });

  it('uses the app definition, not a fixed map (--border -> --line-strong stays --line-strong)', async () => {
    const dir = game({
      'index.css': `${withRoot('  --line-strong: #ccc;\n  --border: var(--line-strong);')}`,
      'A.tsx': 'const c = "border-[var(--border)] text-[var(--ink)]";',
    });
    const r = await migrateTailwindTokens({ dir, write: true });
    expect(read(dir, 'A.tsx')).toBe('const c = "border-line-strong text-ink";');
    expect(r.inlinedAliases).toEqual([{ alias: '--border', target: '--line-strong' }]);
  });

  it('reports and skips an alias that resolves differently in light and dark', async () => {
    const css = `${withRoot('  --surface: var(--paper);')}:root[data-theme='dark'] {\n  --paper: #000;\n  --surface: var(--ink);\n}\n`;
    const dir = game({ 'index.css': css, 'A.tsx': 'const c = "bg-[var(--surface)]";' });
    const r = await migrateTailwindTokens({ dir, write: true });
    expect(read(dir, 'index.css')).toContain('--surface: var(--paper);');
    expect(read(dir, 'A.tsx')).toBe('const c = "bg-[var(--surface)]";');
    expect(r.skippedAliases).toEqual([
      { alias: '--surface', reason: 'resolves to --paper in light but --ink in dark' },
    ]);
    expect(r.inlinedAliases).toEqual([]);
  });

  it('does not ban --bg (the brand-tokens check still needs it)', async () => {
    const css = withRoot('  --bg: #ffffff;');
    const dir = game({ 'index.css': css, 'A.tsx': 'const c = "bg-[var(--bg)]";' });
    await migrateTailwindTokens({ dir, write: true });
    expect(read(dir, 'index.css')).toContain('--bg: #ffffff;');
    expect(read(dir, 'A.tsx')).toBe('const c = "bg-[var(--bg)]";');
  });

  it('renames --error to --danger when the app has no --danger', async () => {
    const dir = game({
      'index.css': `${withRoot('  --error: #dc2626;')}.x { color: var(--error); }\n`,
      'A.tsx': 'const c = "text-[var(--error)] text-[var(--danger)]";',
    });
    const r = await migrateTailwindTokens({ dir, write: true });
    const css = read(dir, 'index.css');
    expect(css).toContain('--danger: #dc2626;');
    expect(css).toContain('color: var(--danger);');
    expect(css).not.toContain('--error');
    expect(css).toContain('--color-danger: var(--danger);');
    expect(read(dir, 'A.tsx')).toBe('const c = "text-danger text-danger";');
    expect(r.renamedAliases).toEqual([{ alias: '--error', target: '--danger' }]);
  });

  it('does not rename --error when --danger already exists with another value', async () => {
    const dir = game({ 'index.css': withRoot('  --danger: #b91c1c;\n  --error: #dc2626;') });
    const r = await migrateTailwindTokens({ dir, write: true });
    expect(read(dir, 'index.css')).toContain('--error: #dc2626;');
    expect(r.renamedAliases).toEqual([]);
    expect(r.skippedAliases.map((s) => s.alias)).toEqual(['--error']);
  });

  it('reports --glass and --dock, which hold literal colours, instead of guessing', async () => {
    const dir = game({
      'index.css': withRoot('  --glass: rgba(255, 255, 255, 0.8);\n  --dock: #ffffff;'),
    });
    const r = await migrateTailwindTokens({ dir, write: true });
    expect(r.skippedAliases.map((s) => s.alias).sort()).toEqual(['--dock', '--glass']);
    expect(read(dir, 'index.css')).toContain('--glass: rgba(255, 255, 255, 0.8);');
  });

  it('is a dry run by default and idempotent when written', async () => {
    const files = { 'index.css': INDEX, 'A.tsx': 'const c = "text-[var(--muted)]";' };
    const dir = game(files);
    const dry = await migrateTailwindTokens({ dir, write: false });
    expect(dry.replacements).toBeGreaterThan(0);
    expect(dry.changes.find((c) => c.file === 'web/src/A.tsx')?.diff).toContain(
      '+const c = "text-muted";',
    );
    expect(read(dir, 'A.tsx')).toBe(files['A.tsx']);
    expect(read(dir, 'index.css')).toBe(INDEX);
    await migrateTailwindTokens({ dir, write: true });
    expect(read(dir, 'A.tsx')).toBe('const c = "text-muted";');
    const snapshot = [read(dir, 'A.tsx'), read(dir, 'index.css')];
    const again = await migrateTailwindTokens({ dir, write: true });
    expect(again.changes).toEqual([]);
    expect([read(dir, 'A.tsx'), read(dir, 'index.css')]).toEqual(snapshot);
  });

  it('is idempotent with aliases and a rename in play', async () => {
    const dir = game({
      'index.css': withRoot('  --surface: var(--paper);\n  --error: #dc2626;'),
      'A.tsx': 'const c = "bg-[var(--surface)] text-[var(--error)]";',
    });
    await migrateTailwindTokens({ dir, write: true });
    expect((await migrateTailwindTokens({ dir, write: true })).changes).toEqual([]);
  });

  it('reports unlayered rules, hex and dark overrides it cannot fix, with counts', async () => {
    const css = `${INDEX}.card { color: #abc; }\n@layer base { body { margin: 0; } }\n:root[data-theme='dark'] .card { color: red; }\n`;
    const dir = game({
      'index.css': css,
      'A.tsx': [
        'const a = <div style={{ color: "red" }} />;',
        '// dynamic: sprite position',
        'const b = <div style={{ left: x }} />;',
      ].join('\n'),
    });
    const r = await migrateTailwindTokens({ dir, write: false });
    const text = r.report.join('\n');
    expect(text).toMatch(/unlayered rule/);
    expect(text).toMatch(/hex value/);
    expect(text).toMatch(/dark override/);
    expect(text).toMatch(/1 static inline style/);
    expect(r.leftovers).toMatchObject({ hexValues: 1, inlineStyles: 1 });
    expect(r.leftovers.unlayeredRules).toBeGreaterThan(0);
  });

  it('reports a missing index.css without rewriting anything', async () => {
    const src = 'const c = "text-[var(--ink)]";';
    const dir = game({ 'A.tsx': src });
    const r = await migrateTailwindTokens({ dir, write: true });
    expect(read(dir, 'A.tsx')).toBe(src);
    expect(r.report.join('\n')).toMatch(/index\.css not found/);
  });

  it('ignores node_modules and dist under web/src', async () => {
    const src = 'const c = "text-[var(--ink)]";';
    const dir = game({
      'index.css': INDEX,
      'node_modules/x/A.tsx': src,
      'dist/B.tsx': src,
    });
    await migrateTailwindTokens({ dir, write: true });
    expect(read(dir, 'node_modules/x/A.tsx')).toBe(src);
    expect(read(dir, 'dist/B.tsx')).toBe(src);
  });

  it('errors without a web/src directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fgs-migrate-'));
    made.push(dir);
    await expect(migrateTailwindTokens({ dir, write: false })).rejects.toThrow(/web\/src/);
  });

  it('migrates apps/console and apps/admin independently from the platform root', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fgs-migrate-'));
    made.push(dir);
    for (const app of ['console', 'admin']) {
      const base = join(dir, 'apps', app, 'web/src');
      mkdirSync(base, { recursive: true });
      writeFileSync(join(base, 'index.css'), INDEX);
      writeFileSync(join(base, 'A.tsx'), `const ${app} = "text-[var(--ink)]";`);
    }
    const r = await migrateTailwindTokens({ dir, write: true });
    expect(r.changes.map((c) => c.file).sort()).toEqual([
      'apps/admin/web/src/A.tsx',
      'apps/admin/web/src/index.css',
      'apps/console/web/src/A.tsx',
      'apps/console/web/src/index.css',
    ]);
    expect(readFileSync(join(dir, 'apps/console/web/src/A.tsx'), 'utf8')).toBe(
      'const console = "text-ink";',
    );
    expect(readFileSync(join(dir, 'apps/admin/web/src/index.css'), 'utf8')).toContain(
      '@theme inline',
    );
    expect((await migrateTailwindTokens({ dir, write: true })).changes).toEqual([]);
  });
});

describe('renderMigrateResult', () => {
  const collect = () => {
    let text = '';
    return {
      write: (s: string) => {
        text += s;
        return true;
      },
      get text() {
        return text;
      },
    };
  };

  it('prints the diff and a dry-run footer, and changes nothing', async () => {
    const dir = game({ 'index.css': INDEX, 'A.tsx': 'const c = "text-[var(--muted)]";' });
    const out = collect();
    renderMigrateResult(await migrateTailwindTokens({ dir, write: false }), out as never);
    expect(out.text).toContain('-const c = "text-[var(--muted)]";');
    expect(out.text).toContain('+const c = "text-muted";');
    expect(out.text).toContain('Dry run:');
    expect(read(dir, 'A.tsx')).toBe('const c = "text-[var(--muted)]";');
  });

  it('prints a write summary without the diff', async () => {
    const dir = game({ 'index.css': INDEX, 'A.tsx': 'const c = "text-[var(--muted)]";' });
    const out = collect();
    renderMigrateResult(await migrateTailwindTokens({ dir, write: true }), out as never);
    expect(out.text).toContain('Wrote 2 file(s)');
    expect(out.text).not.toContain('--- a/');
  });
});
