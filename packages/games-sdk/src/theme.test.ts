/** @vitest-environment node */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// platform#393: the SDK ships its animations and extra tokens as Tailwind
// theme entries in theme.css. This keeps the components and the file in step.

const here = fileURLToPath(new URL('.', import.meta.url));
const theme = readFileSync(`${here}theme.css`, 'utf8');

function componentSources(dir: string): string {
  return readdirSync(dir, { withFileTypes: true })
    .map((entry) => {
      if (entry.isDirectory()) return componentSources(`${dir}${entry.name}/`);
      return /\.tsx$/.test(entry.name) && !/\.test\./.test(entry.name)
        ? readFileSync(`${dir}${entry.name}`, 'utf8')
        : '';
    })
    .join('\n');
}
const components = componentSources(here);

describe('theme.css (#393)', () => {
  it('defines a --animate-* entry for every animate-fgs-* utility the components use', () => {
    const used = new Set([...components.matchAll(/\banimate-(fgs-[a-z-]+)/g)].map((m) => m[1]));
    expect(used.size).toBeGreaterThan(5);
    for (const name of used) {
      expect(theme, `--animate-${name}`).toMatch(new RegExp(`--animate-${name}:`));
    }
  });

  it('defines the keyframes every animation references', () => {
    const referenced = new Set(
      [...theme.matchAll(/--animate-[a-z-]+:\s*([a-z-]+)\s/g)].map((m) => m[1]),
    );
    expect(referenced.size).toBeGreaterThan(3);
    for (const name of referenced) {
      expect(theme, `@keyframes ${name}`).toMatch(new RegExp(`@keyframes ${name}\\b`));
    }
  });

  it('reads its durations from the motion tokens, not from literals', () => {
    // A duration sits straight after the animation name; delays and the float loop are offsets.
    const literalDuration = /--animate-[a-z-]+:\s*[a-z-]+\s+\d+ms\b/;
    expect(theme.split('\n').filter((line) => literalDuration.test(line))).toEqual([]);
    expect(theme).toContain('var(--motion-slow');
    expect(theme).toContain('var(--motion-base');
  });

  it('defines the extra colour and size utilities the components use', () => {
    for (const name of [
      'text-accent-ink',
      'rounded-fgs',
      'text-fgs-title',
      'text-fgs-stat',
      'text-fgs-display',
    ]) {
      expect(components, name).toContain(name);
    }
    for (const entry of [
      '--color-accent-ink',
      '--radius-fgs',
      '--text-fgs-title',
      '--text-fgs-stat',
      '--text-fgs-display',
    ]) {
      expect(theme, entry).toContain(`${entry}:`);
    }
  });

  it('is shipped by the package: copied into dist, exported, in the files list', () => {
    const pkg = JSON.parse(readFileSync(`${here}../package.json`, 'utf8')) as {
      exports: Record<string, unknown>;
      scripts: { build: string };
      files: string[];
    };
    expect(pkg.scripts.build).toContain('src/theme.css');
    expect(pkg.exports['./theme.css']).toBe('./dist/theme.css');
    expect(pkg.files).toContain('dist');
  });
});
