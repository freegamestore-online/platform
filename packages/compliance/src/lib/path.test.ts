import { describe, expect, it } from 'vitest';
import { extOf } from './path.js';

describe('extOf (#368)', () => {
  it.each([
    ['web/src/App.tsx', '.tsx'],
    ['web/src/App.TSX', '.tsx'],
    ['web/index.html', '.html'],
    ['styles/theme.module.css', '.css'],
    ['web/.vite/cache', ''],
    ['LICENSE', ''],
    ['.env', '.env'],
  ])('%s -> %j', (path, ext) => {
    expect(extOf(path)).toBe(ext);
  });
});
