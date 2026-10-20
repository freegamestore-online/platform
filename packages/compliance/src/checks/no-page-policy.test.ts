import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fsFileSource } from '../lib/fs-file-source.js';
import { checkNoPagePolicy } from './no-page-policy.js';

// #369: a page-level CSP or Permissions-Policy can only take away what the host
// allows, so it's flagged (as a warning) for the creator to look at.

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fgs-compliance-page-policy-'));
  await mkdir(join(dir, 'web'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function head(html: string): Promise<void> {
  await writeFile(join(dir, 'web', 'index.html'), `<html><head>${html}</head></html>`);
}

describe('checkNoPagePolicy (#369)', () => {
  it('passes a page with no meta policy', async () => {
    await head('<meta charset="utf-8"><meta http-equiv="X-UA-Compatible" content="IE=edge">');
    expect((await checkNoPagePolicy(fsFileSource(dir))).status).toBe('pass');
  });

  it('warns on a meta Content-Security-Policy, as the bowling/chess/mahjong ones', async () => {
    await head(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'">`,
    );
    const r = await checkNoPagePolicy(fsFileSource(dir));
    expect(r.status).toBe('warn');
    expect(r.detail).toContain('Content-Security-Policy');
    expect(r.suggestions?.join(' ')).toContain('api.freegamestore.online');
  });

  it('warns on a meta Permissions-Policy, in any case', async () => {
    await head(`<META HTTP-EQUIV='permissions-policy' content="camera=()">`);
    const r = await checkNoPagePolicy(fsFileSource(dir));
    expect(r.status).toBe('warn');
    expect(r.detail).toContain('Permissions-Policy');
  });

  it('ignores a policy inside an HTML comment', async () => {
    await head(`<!-- <meta http-equiv="Content-Security-Policy" content="default-src 'self'"> -->`);
    expect((await checkNoPagePolicy(fsFileSource(dir))).status).toBe('pass');
  });

  it('never fails a game, only warns', async () => {
    await head(
      `<meta http-equiv="Content-Security-Policy" content="x"><meta http-equiv="Permissions-Policy" content="y">`,
    );
    expect((await checkNoPagePolicy(fsFileSource(dir))).status).not.toBe('fail');
  });

  it('passes a project with no web/index.html', async () => {
    await rm(join(dir, 'web'), { recursive: true });
    expect((await checkNoPagePolicy(fsFileSource(dir))).status).toBe('pass');
  });
});
