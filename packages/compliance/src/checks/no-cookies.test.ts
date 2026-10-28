import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fsFileSource } from '../lib/fs-file-source.js';
import { checkNoCookies } from './no-cookies.js';

// #373: first-party cookies are equivalent to localStorage, so they warn.

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fgs-compliance-cookies-'));
  await mkdir(join(dir, 'web', 'src'), { recursive: true });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('checkNoCookies (#373)', () => {
  it('passes when no cookies are used', async () => {
    await writeFile(join(dir, 'web', 'src', 'a.ts'), "localStorage.setItem('best', '10');");
    expect((await checkNoCookies(fsFileSource(dir))).status).toBe('pass');
  });

  it('warns (does not fail) on document.cookie', async () => {
    await writeFile(join(dir, 'web', 'src', 'a.ts'), "document.cookie = 'best=10; path=/';");
    const r = await checkNoCookies(fsFileSource(dir));
    expect(r.status).toBe('warn');
    expect(r.detail).toMatch(/document\.cookie/);
  });

  it('warns on a js-cookie import', async () => {
    await writeFile(join(dir, 'web', 'src', 'a.ts'), "import Cookies from 'js-cookie';");
    const r = await checkNoCookies(fsFileSource(dir));
    expect(r.status).toBe('warn');
    expect(r.detail).toMatch(/js-cookie/);
  });

  it('ignores document.cookie in a comment', async () => {
    await writeFile(join(dir, 'web', 'src', 'a.ts'), '// never use document.cookie\nexport {};');
    expect((await checkNoCookies(fsFileSource(dir))).status).toBe('pass');
  });
});
