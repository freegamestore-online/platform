/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import html from '../index.html?raw';
import css from './index.css?raw';

// platform#394 (ADR-001, DESIGN-SYSTEM.md): the console is Tailwind utilities on
// tokens, light + dark through `data-theme`. Surfaces are opaque, the retired
// aliases are gone, and inline `style` is only for runtime values marked `Dynamic:`.

// Every component source, read as text. Test files are not components.
const sources = import.meta.glob<string>('./**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const files = Object.keys(sources)
  .filter((f) => !/\.test\.tsx$/.test(f))
  .map((f) => f.replace(/^\.\//, ''))
  .sort();
const read = (file: string): string => sources[`./${file}`] ?? '';

/** Strip comments so issue references like `#394` are not read as hex colours. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/&#\d+;/g, '');
}

/** Every `--name: value;` declaration of one custom property. */
function declarations(name: string): string[] {
  return [...css.matchAll(new RegExp(`${name}\\s*:\\s*([^;]+);`, 'g'))].map((m) =>
    (m[1] ?? '').trim(),
  );
}

describe('console tokens (#394)', () => {
  it('defines the spec tokens in a light :root and a dark data-theme block', () => {
    const dark = css.slice(css.indexOf(':root[data-theme="dark"]'));
    expect(css).toContain(':root {');
    for (const token of [
      '--paper',
      '--panel',
      '--popover',
      '--ink',
      '--muted',
      '--line',
      '--accent',
      '--danger',
      '--danger-soft',
      '--success',
      '--warning',
    ]) {
      expect(css, `${token} (light)`).toContain(`${token}:`);
      if (token !== '--popover') expect(dark, `${token} (dark)`).toContain(`${token}:`);
    }
  });

  it('has opaque --paper, --panel and --popover in both themes', () => {
    for (const token of ['--paper', '--panel', '--popover']) {
      const values = declarations(token);
      expect(values.length, `${token} is defined`).toBeGreaterThan(0);
      for (const value of values) {
        expect(value, `${token}: ${value}`).not.toMatch(
          /rgba?\([^)]*,\s*0?\.\d+\s*\)|transparent|\/\s*\d/,
        );
      }
    }
  });

  it('no longer defines or uses the retired aliases', () => {
    for (const alias of [
      'bg',
      'surface',
      'border',
      'glass',
      'dock',
      'error',
      'overlay-bg',
      'z-modal',
    ]) {
      expect(css, `--${alias} in index.css`).not.toMatch(new RegExp(`--${alias}\\s*:`));
    }
    for (const file of files) {
      expect(code(read(file)), file).not.toMatch(
        /var\(--(bg|surface|border|glass|dock|error|overlay-bg|z-modal)\b/,
      );
    }
  });

  it('switches dark mode with data-theme, never a .dark class', () => {
    expect(css).not.toMatch(/\.dark\b|html\.dark/);
    expect(css).toContain(':root[data-theme="dark"]');
  });

  it('keeps index.css to tokens, @theme and @layer: no unlayered rules or feature classes', () => {
    expect(css).toMatch(/@theme inline\s*\{/);
    expect(css).not.toContain('.no-scrollbar');
    const outsideBlocks = css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/@theme inline\s*\{[^}]*\}/, '')
      .replace(/:root(\[data-theme="dark"\])?\s*\{[^}]*\}/g, '')
      .replace(/@layer base\s*\{[\s\S]*\}\s*$/, '');
    expect(outsideBlocks.trim()).toBe('@import "tailwindcss";');
  });

  it('maps every token the components use through @theme inline', () => {
    const start = css.indexOf('@theme inline');
    const theme = css.slice(start, css.indexOf('\n}', start));
    const used = new Set<string>();
    const re =
      /\b(?:bg|text|border|ring|divide|from|to|via|fill|stroke|shadow)-(paper|panel-alt|panel|popover|ink-strong|ink|muted|line-strong|line|accent-hover|accent-soft|accent|danger-soft|danger|success-soft|success|warning-soft|warning|pro|scrim)\b/g;
    for (const file of files) {
      for (const m of read(file).matchAll(re)) used.add(m[1] as string);
    }
    expect(used.size).toBeGreaterThan(8);
    for (const name of used) {
      expect(theme, `--color-${name}`).toContain(`--color-${name}: var(--${name});`);
    }
  });

  it('applies the saved theme before first paint with the shared stores-theme key', () => {
    expect(html).toContain('stores-theme');
    expect(html).toContain('prefers-color-scheme: dark');
    expect(html).toContain('dataset.theme');
    expect(html.indexOf('stores-theme')).toBeLessThan(html.indexOf('</head>'));
  });
});

describe('console components (#394)', () => {
  it('finds the component files', () => {
    expect(files).toEqual(
      expect.arrayContaining(['App.tsx', 'pages/Create.tsx', 'components/Nav.tsx']),
    );
  });

  for (const file of files) {
    it(`${file} has no static inline style, injected CSS or raw colour`, () => {
      const source = read(file);
      const lines = source.split('\n');
      lines.forEach((line, i) => {
        if (!line.includes('style={{')) return;
        const context = lines.slice(Math.max(0, i - 3), i + 1).join('\n');
        expect(context, `${file}:${i + 1} inline style needs a "Dynamic:" comment`).toMatch(
          /Dynamic:/,
        );
      });
      // The icon background colour is saved game data (it feeds <input type="color">), not styling.
      const text = code(lines.filter((l) => !/iconBg|IconBg/.test(l)).join('\n'));
      expect(text, `${file} injects CSS`).not.toMatch(
        /<style[\s>]|createElement\(\s*['"]style['"]/,
      );
      expect(text, `${file} has a raw colour`).not.toMatch(
        /#[0-9a-fA-F]{3,8}\b|rgba?\(|color-mix\(/,
      );
      // A solid danger surface is light in dark mode, so white text on it is unreadable there.
      expect(text, `${file} has white text on a solid danger background`).not.toMatch(
        /bg-danger(?![/-])[^"'`]*text-white|text-white[^"'`]*bg-danger(?![/-])/,
      );
      expect(text, `${file} uses CSS-in-JS objects`).not.toMatch(/React\.CSSProperties\s*=\s*\{/);
    });
  }
});
