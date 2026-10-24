import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

// Exercise the actual Workers HTMLRewriter and R2/D1 APIs, not a parser mock.
let mf: Miniflare;
const html = '<!doctype html><html><head><title>Old</title><meta name="description" content="old"><meta property="og:title" content="old"><link rel="canonical" href="https://wrong.example/"></head><body><div id="root">Play now</div><script>const text="<title>keep script</title>";</script></body></html>';
const draftHtml = '<html><head><title>Draft</title></head><body><div id="root"></div></body></html>';
beforeAll(async () => {
  // Miniflare's local HTTP transport rewrites Host to its loopback listener.
  // Restore the intended ingress host before calling the unchanged Worker.
  const bundle = await build({ stdin: { contents: `import worker from './src/index.ts';
    export default { fetch(req, env, ctx) {
      const url = new URL(req.url); url.host = req.headers.get('x-test-host');
      const headers = new Headers(req.headers); headers.set('host', url.host);
      return worker.fetch(new Request(url, { method: req.method, headers }), env, ctx);
    } };`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'browser' });
  mf = new Miniflare({
    modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2024-12-01',
    d1Databases: ['DB'], r2Buckets: ['APPS'],
    outboundService: async () => Response.json({ games: [
      ...['live', 'pending', 'failed', 'private', 'unpublished', 'approved', 'published', 'typo'].map((status) => ({
        id: status, status, name: 'Game <"&>', description: 'Approved <description> & "text"', appUrl: `https://${status}.freegamestore.online`,
      })),
      { id: 'legacy', name: 'Legacy', description: 'Legacy description', appUrl: 'https://legacy.freegamestore.online' },
      { id: 'empty', name: 'Empty', description: '', appUrl: 'https://empty.freegamestore.online' },
      { id: 'unbuilt', name: 'Unbuilt', description: 'No build', appUrl: 'https://unbuilt.freegamestore.online' },
      { id: 'isolated', name: 'Threaded', description: 'Shared memory', appUrl: 'https://isolated.freegamestore.online', crossOriginIsolated: true },
    ] }),
  });
  const db = await mf.getD1Database('DB');
  await db.exec('CREATE TABLE routes (slug TEXT, zone TEXT, r2_prefix TEXT, store TEXT, hosted_on TEXT)');
  const bucket = await mf.getR2Bucket('APPS');
  for (const slug of ['live', 'pending', 'failed', 'private', 'unpublished', 'approved', 'published', 'typo', 'legacy', 'empty', 'unbuilt', 'unlisted', 'isolated']) {
    await db.prepare("INSERT INTO routes VALUES (?1, 'freegamestore.online', ?2, 'games', 'r2')").bind(slug, `games/${slug}`).run();
    if (slug !== 'unbuilt') await bucket.put(`games/${slug}/index.html`, ['pending', 'failed', 'private', 'unpublished', 'typo', 'unlisted'].includes(slug) ? draftHtml : html);
    await bucket.put(`games/${slug}/assets/game.js`, 'gameplay();');
  }
}, 30_000);
afterAll(async () => { await mf?.dispose(); });
const hit = async (slug: string, path = '/', init?: { method?: string; headers?: Record<string, string> }) =>
  mf.dispatchFetch(`https://${slug}.freegamestore.online${path}`, { ...init, headers: { ...init?.headers, 'x-test-host': `${slug}.freegamestore.online` } });

describe('public-game SEO', () => {
  it.each(['live', 'approved', 'published', 'legacy'])('publishes crawl files and root metadata for %s', async (slug) => {
    const robots = await hit(slug, '/robots.txt');
    expect(robots.status).toBe(200);
    expect(await robots.text()).toBe(`User-agent: *\nAllow: /\nSitemap: https://${slug}.freegamestore.online/sitemap.xml\n`);
    const sitemap = await hit(slug, '/sitemap.xml');
    expect(sitemap.headers.get('content-type')).toContain('application/xml');
    expect(await sitemap.text()).toContain(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://${slug}.freegamestore.online/</loc></url></urlset>`);
    for (const path of ['/', '/index.html?tracking=ignore']) {
      const response = await hit(slug, path, { headers: { 'if-none-match': '"old"' } });
      const body = await response.text();
      expect(response.status).toBe(200);
      expect(response.headers.get('etag')).toBeNull();
      expect(body).toContain(`<link rel="canonical" href="https://${slug}.freegamestore.online/">`);
      expect(body).toContain('property="og:site_name" content="Free Game Store"');
      expect(body).toContain('name="twitter:card" content="summary"');
      for (const name of ['og:title', 'og:description', 'og:url', 'og:type', 'og:site_name', 'twitter:title', 'twitter:description']) {
        expect(body.split(`="${name}"`).length - 1).toBe(1);
      }
      expect(body).not.toContain('https://wrong.example/');
      expect(body).not.toContain('content="old"');
      expect(body).toContain('<div id="root">Play now</div>');
      expect(body).toContain('const text="<title>keep script</title>";');
      if (slug !== 'legacy') expect(body).toContain('Approved &lt;description&gt; &amp; &quot;text&quot;');
    }
  });
  it.each([
    ['<meta name="twitter:card" content="summary_large_image">', 'summary_large_image'],
    ['<meta content="player" name="twitter:card">', 'player'],
    ['<meta name="twitter:card" content="  ">', 'summary'],
    ['', 'summary'],
    ['<meta name="twitter:card" content=""><meta name="twitter:card" content="summary_large_image"><meta name="twitter:card" content="summary">', 'summary_large_image'],
  ])('retains authored social media and a single card directive (%s)', async (card, expectedCard) => {
    const bucket = await mf.getR2Bucket('APPS');
    const social = '<meta property="og:image" content="https://live.freegamestore.online/preview.png">' +
      '<meta property="og:image:alt" content="Game preview"><meta property="og:image:width" content="1200">' +
      '<meta property="og:image:height" content="630"><meta property="og:video" content="https://live.freegamestore.online/preview.mp4">' +
      '<meta name="twitter:image" content="https://live.freegamestore.online/preview.png">' +
      '<meta name="twitter:image:alt" content="Game preview"><meta name="twitter:site" content="@game"><meta name="twitter:creator" content="@creator">';
    await bucket.put('games/live/index.html', html.replace('</head>', `${social}${card}</head>`));
    try {
      for (const path of ['/', '/index.html?utm_source=share']) {
        const response = await hit('live', path);
        const body = await response.text();
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(response.headers.get('etag')).toBeNull();
        expect(body).toContain(social);
        const cards = [...body.matchAll(/<meta[^>]*name="twitter:card"[^>]*>/g)];
        expect(cards).toHaveLength(1);
        expect(cards[0][0]).toContain(`content="${expectedCard}"`);
        expect(body).toContain('<link rel="canonical" href="https://live.freegamestore.online/">');
        expect(body).toContain('Approved &lt;description&gt; &amp; &quot;text&quot;');
        expect(body).not.toContain('content="old"');
        expect(body).toContain('<div id="root">Play now</div>');
        expect(body).toContain('const text="<title>keep script</title>";');
      }
    } finally {
      await bucket.put('games/live/index.html', html);
    }
  });
  it.each(['pending', 'failed', 'private', 'unpublished', 'typo', 'unlisted'])('does not advertise %s', async (slug) => {
    expect(await (await hit(slug, '/robots.txt')).text()).toBe('User-agent: *\nDisallow: /\n');
    expect((await hit(slug, '/sitemap.xml')).status).toBe(404);
    const body = await (await hit(slug)).text();
    expect(body).toBe(draftHtml);
    expect(body).not.toContain('og:');
  });
  it('does not manufacture discovery for missing games or unbuilt routes', async () => {
    for (const path of ['/', '/robots.txt', '/sitemap.xml']) expect((await hit('unknown', path)).status).toBe(404);
    expect((await hit('unbuilt', '/sitemap.xml')).status).toBe(404);
    expect(await (await hit('unbuilt', '/robots.txt')).text()).toContain('Disallow: /');
  });
  it('skips missing descriptions and preserves assets, SPA fallback, HEAD and method handling', async () => {
    expect(await (await hit('empty')).text()).toBe(html);
    expect(await (await hit('live', '/level/3')).text()).toBe(html);
    expect(await (await hit('live', '/assets/game.js')).text()).toBe('gameplay();');
    for (const path of ['/', '/robots.txt', '/sitemap.xml']) {
      expect(await (await hit('live', path, { method: 'HEAD' })).text()).toBe('');
      expect((await hit('live', path, { method: 'POST' })).status).toBe(405);
    }
  });
});

it('uses deployed registry isolation on transformed HTML and worker assets in the Workers runtime', async () => {
  for (const slug of ['isolated', 'live']) {
    for (const path of ['/', '/assets/game.js']) {
      const response = await hit(slug, path);
      expect(response.status).toBe(200);
      expect(response.headers.get('cross-origin-opener-policy')).toBe(slug === 'isolated' ? 'same-origin' : null);
      expect(response.headers.get('cross-origin-embedder-policy')).toBe(slug === 'isolated' ? 'credentialless' : null);
    }
  }
});
