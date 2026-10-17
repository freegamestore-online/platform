import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fsFileSource } from '../lib/fs-file-source.js';
import { checkNoExternalScripts } from './no-external-scripts.js';

// #356: a game's index.html may load the platform analytics loader and the font
// CDNs, and nothing else from outside the platform.

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fgs-compliance-scripts-'));
  await mkdir(join(dir, 'web'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function indexWith(scripts: string): Promise<void> {
  await writeFile(join(dir, 'web', 'index.html'), `<html><head>${scripts}</head></html>`);
}

describe('checkNoExternalScripts (#356)', () => {
  it('passes the platform analytics loader', async () => {
    await indexWith(
      '<script src="https://api.freegamestore.online/v1/analytics.js?app=chess" defer></script>',
    );
    expect((await checkNoExternalScripts(fsFileSource(dir))).status).toBe('pass');
  });

  it('passes the font CDNs', async () => {
    await indexWith('<script src="https://fonts.googleapis.com/x.js"></script>');
    expect((await checkNoExternalScripts(fsFileSource(dir))).status).toBe('pass');
  });

  it('fails a direct Cloudflare Web Analytics beacon, which must go through the loader', async () => {
    await indexWith('<script src="https://static.cloudflareinsights.com/beacon.min.js"></script>');
    const r = await checkNoExternalScripts(fsFileSource(dir));
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/static\.cloudflareinsights\.com/);
  });

  it("fails another game's subdomain, even one that serves a script at the loader's path", async () => {
    await indexWith(
      '<script src="https://evilgame.freegamestore.online/v1/analytics.js"></script>',
    );
    expect((await checkNoExternalScripts(fsFileSource(dir))).status).toBe('fail');
  });

  it('fails the platform host at any other path', async () => {
    await indexWith('<script src="https://api.freegamestore.online/v1/other.js"></script>');
    expect((await checkNoExternalScripts(fsFileSource(dir))).status).toBe('fail');
  });

  it('fails a direct third-party tracker', async () => {
    await indexWith('<script src="https://www.googletagmanager.com/gtag/js?id=G-X"></script>');
    expect((await checkNoExternalScripts(fsFileSource(dir))).status).toBe('fail');
  });
});
