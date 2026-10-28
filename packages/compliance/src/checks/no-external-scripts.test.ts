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

// #373: a non-platform https script is allowed with a warning only when it
// carries Subresource Integrity and crossorigin. Otherwise it still fails.
describe('checkNoExternalScripts: SRI policy (#373)', () => {
  const SRI = 'sha384-oqVuAfXRKap7fdgcCY5uykM6+R9GqQ8K/uxy9rx7HNQlGYl1kPzQho1wx4JwY8wC';

  it('warns, naming the host, for https + integrity + crossorigin', async () => {
    await indexWith(
      `<script src="https://cdn.example.com/engine.js" integrity="${SRI}" crossorigin="anonymous"></script>`,
    );
    const r = await checkNoExternalScripts(fsFileSource(dir));
    expect(r.status).toBe('warn');
    expect(r.detail).toMatch(/cdn\.example\.com/);
  });

  it('accepts a bare crossorigin attribute and sha256 / sha512 digests', async () => {
    await indexWith(
      '<script src="https://a.example.com/a.js" integrity="sha256-abc123+/=" crossorigin></script>' +
        '<script crossorigin="anonymous" integrity="sha512-abc123" src="https://b.example.com/b.js"></script>',
    );
    const r = await checkNoExternalScripts(fsFileSource(dir));
    expect(r.status).toBe('warn');
    expect(r.detail).toMatch(/a\.example\.com, b\.example\.com/);
  });

  it('fails https with integrity but no crossorigin', async () => {
    await indexWith(`<script src="https://cdn.example.com/engine.js" integrity="${SRI}"></script>`);
    const r = await checkNoExternalScripts(fsFileSource(dir));
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/without crossorigin/);
  });

  it('fails https with no integrity', async () => {
    await indexWith('<script src="https://cdn.example.com/engine.js" crossorigin></script>');
    const r = await checkNoExternalScripts(fsFileSource(dir));
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/no integrity/);
  });

  it('fails an integrity value that is not a sha256/384/512 digest', async () => {
    await indexWith(
      '<script src="https://cdn.example.com/engine.js" integrity="md5-abc" crossorigin></script>',
    );
    expect((await checkNoExternalScripts(fsFileSource(dir))).status).toBe('fail');
  });

  it('fails plain http even with integrity and crossorigin', async () => {
    await indexWith(
      `<script src="http://cdn.example.com/engine.js" integrity="${SRI}" crossorigin="anonymous"></script>`,
    );
    const r = await checkNoExternalScripts(fsFileSource(dir));
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/plain http/);
  });

  it('fails a protocol-relative URL even with integrity and crossorigin', async () => {
    await indexWith(
      `<script src="//cdn.example.com/engine.js" integrity="${SRI}" crossorigin="anonymous"></script>`,
    );
    expect((await checkNoExternalScripts(fsFileSource(dir))).status).toBe('fail');
  });

  it('fails when any script is a hard failure, even if another has SRI', async () => {
    await indexWith(
      `<script src="https://ok.example.com/a.js" integrity="${SRI}" crossorigin="anonymous"></script>` +
        '<script src="https://bad.example.com/b.js"></script>',
    );
    const r = await checkNoExternalScripts(fsFileSource(dir));
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/bad\.example\.com/);
  });

  it('keeps the allowlisted CDN and loader passing without SRI', async () => {
    await indexWith(
      '<script src="https://fonts.gstatic.com/x.js"></script>' +
        '<script src="https://api.freegamestore.online/v1/analytics.js?app=chess" defer></script>',
    );
    expect((await checkNoExternalScripts(fsFileSource(dir))).status).toBe('pass');
  });

  it('ignores a data-src attribute and relative scripts', async () => {
    await indexWith(
      '<script type="module" src="/src/main.tsx"></script><script data-src="https://x.example.com/a.js"></script>',
    );
    expect((await checkNoExternalScripts(fsFileSource(dir))).status).toBe('pass');
  });
});
