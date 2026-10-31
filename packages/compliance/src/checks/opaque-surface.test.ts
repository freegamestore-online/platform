import { describe, expect, it } from 'vitest';
import { mapFileSource } from '../lib/file-source.js';
import { checkOpaqueSurface } from './opaque-surface.js';

const run = (css: string) =>
  checkOpaqueSurface(mapFileSource(new Map([['web/src/index.css', css]])));

// platform#396: --paper / --panel / --popover must be opaque. Warn only.

describe('checkOpaqueSurface (#396)', () => {
  it('passes opaque surface tokens', async () => {
    const r = await run(
      ':root { --paper: #fff; --panel: rgb(249, 250, 251); --popover: rgba(0, 0, 0, 1); }',
    );
    expect(r.status).toBe('pass');
  });

  it('passes when no surface token is defined', async () => {
    expect((await run(':root { --ink: #111; }')).status).toBe('pass');
  });

  it('warns on a translucent --panel and names the file, line and alpha', async () => {
    const r = await run(':root {\n  --panel: rgba(255, 255, 255, 0.72);\n}');
    expect(r.status).toBe('warn');
    expect(r.detail).toMatch(
      /web\/src\/index\.css:2 --panel: rgba\(255, 255, 255, 0\.72\) \(alpha 0\.72\)/,
    );
  });

  it.each([
    ['--paper', 'rgb(0 0 0 / 50%)'],
    ['--popover', '#000000cc'],
    ['--panel', 'hsla(0, 0%, 100%, 0.9)'],
    ['--panel', 'transparent'],
  ])('warns on %s: %s', async (token, value) => {
    expect((await run(`:root { ${token}: ${value}; }`)).status).toBe('warn');
  });

  it('ignores translucent tokens that are not surfaces, and unresolvable values', async () => {
    const r = await run(
      ':root { --line: rgba(0,0,0,0.08); --bg-blob-1: rgba(37,99,235,0.07); --panel: var(--other); }',
    );
    expect(r.status).toBe('pass');
  });

  it('flags translucent values inside @layer and dark blocks', async () => {
    const r = await run(
      '@layer base { :root[data-theme="dark"] { --panel: rgba(18, 18, 18, 0.8); } }',
    );
    expect(r.status).toBe('warn');
  });
});
