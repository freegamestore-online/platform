import { describe, expect, it } from 'vitest';
import { isSourceCss } from '../lib/css.js';
import { mapFileSource } from '../lib/file-source.js';
import { checkCssDiscipline } from './css-discipline.js';
import { checkOpaqueSurface } from './opaque-surface.js';

// Built and static CSS is not the author's source: scanning a minified bundle
// only produces noise (apps/admin commits public/assets/*.css).

describe('isSourceCss', () => {
  it.each([
    ['web/src/index.css', true],
    ['src/styles/app.css', true],
    ['apps/admin/web/src/index.css', true],
    ['apps/admin/public/assets/index-4KM1f7A6.css', false],
    ['web/dist/assets/index.css', false],
    ['build/app.css', false],
    ['web/src/vendor.min.css', false],
    ['web/src/App.tsx', false],
  ])('%s -> %s', (path, expected) => {
    expect(isSourceCss(path)).toBe(expected);
  });
});

describe('styling checks skip built CSS', () => {
  const built = new Map([
    ['public/assets/index.css', ':root{--panel:#ffffffb8;--error:#c74f43}.btn{color:#f00}'],
  ]);

  it('opaque-surface passes when only built CSS is translucent', async () => {
    expect((await checkOpaqueSurface(mapFileSource(built))).status).toBe('pass');
  });

  it('css-discipline passes when only built CSS breaks the rules', async () => {
    expect((await checkCssDiscipline(mapFileSource(built))).status).toBe('pass');
  });

  it('both still flag the same CSS under web/src', async () => {
    const src = new Map([
      ['web/src/index.css', ':root{--panel:#ffffffb8;--error:#c74f43}.btn{color:#f00}'],
    ]);
    expect((await checkOpaqueSurface(mapFileSource(src))).status).toBe('warn');
    expect((await checkCssDiscipline(mapFileSource(src))).status).toBe('warn');
  });
});
