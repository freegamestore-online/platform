import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// platform#395 (ADR-001): the admin UI is Tailwind utilities on design tokens.
// Panels are opaque, `--error` is `--danger`, and inline `style` is only for
// runtime values, each marked `Dynamic`.

const WEB_SRC = join(process.cwd(), 'web', 'src');
const css = readFileSync(join(WEB_SRC, 'index.css'), 'utf8');
const tsxFiles = readdirSync(WEB_SRC).filter((f) => f.endsWith('.tsx'));
const source = (file: string) => readFileSync(join(WEB_SRC, file), 'utf8');

/** Every `--name: value;` declaration of one custom property. */
function declarations(name: string): string[] {
  return [...css.matchAll(new RegExp(`${name}\\s*:\\s*([^;]+);`, 'g'))].map((m) =>
    (m[1] ?? '').trim(),
  );
}

describe('admin tokens (#395)', () => {
  it('has opaque surface tokens in both themes', () => {
    for (const token of ['--panel', '--panel-strong', '--paper', '--popover']) {
      const values = declarations(token);
      expect(values.length, `${token} is defined`).toBeGreaterThan(0);
      for (const value of values) {
        expect(value, `${token}: ${value}`).not.toMatch(
          /rgba?\([^)]*,\s*0?\.\d+\s*\)|transparent|\/\s*\d/,
        );
      }
    }
    expect(declarations('--panel')).toHaveLength(2);
  });

  it('uses --danger and no longer defines --error', () => {
    expect(declarations('--danger')).toHaveLength(2);
    expect(css).not.toMatch(/--error\b/);
    for (const file of tsxFiles) expect(source(file), file).not.toMatch(/--error\b/);
  });

  it('maps every token the components use through @theme inline', () => {
    expect(css).toMatch(/@theme inline\s*\{/);
    const theme = css.slice(
      css.indexOf('@theme inline'),
      css.indexOf('}', css.indexOf('@theme inline')),
    );
    const used = new Set<string>();
    for (const file of tsxFiles) {
      const re =
        /\b(?:bg|text|border|ring|divide|from|to|via|fill|stroke)-(paper-deep|paper|ink|muted|line-strong|line|panel-strong|panel|popover|accent-soft|accent-deep|accent|success-soft|success|warning-soft|warning|danger-soft|danger|scrim)\b/g;
      for (const m of source(file).matchAll(re)) used.add(m[1] as string);
    }
    expect(used.size).toBeGreaterThan(8);
    for (const name of used)
      expect(theme, `--color-${name}`).toContain(`--color-${name}: var(--${name});`);
  });

  it('defines each token in the light and the dark block', () => {
    const dark = css.slice(css.indexOf(':root[data-theme="dark"]'));
    for (const token of [
      '--danger',
      '--danger-soft',
      '--success-soft',
      '--warning-soft',
      '--scrim',
      '--panel',
    ]) {
      expect(dark, `${token} in dark`).toContain(`${token}:`);
    }
  });
});

describe('admin components (#395)', () => {
  it('finds the component files', () => {
    expect(tsxFiles).toEqual(
      expect.arrayContaining(['App.tsx', 'UserDetail.tsx', 'Grants.tsx', 'Ops.tsx']),
    );
  });

  for (const file of tsxFiles) {
    it(`${file} has no static inline style and no raw colour`, () => {
      const lines = source(file).split('\n');
      lines.forEach((line, i) => {
        if (!line.includes('style={{')) return;
        const context = lines.slice(Math.max(0, i - 3), i + 1).join('\n');
        expect(context, `${file}:${i + 1} inline style needs a "Dynamic:" comment`).toMatch(
          /Dynamic:/,
        );
      });
      // Raw colours belong in tokens. (ProvisionForm's iconBg default is form data, not a style.)
      const code = lines
        .filter((l) => !/iconBg/.test(l))
        .join('\n')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
        .replace(/&#\d+;/g, '');
      expect(code, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|var\(--/);
    });
  }
});
