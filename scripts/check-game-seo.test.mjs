import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditGame } from './check-game-seo.mjs';

test('SEO sweep detects the original missing metadata/crawl contract', async () => {
  const problems = await auditGame(
    { name: 'Game', description: 'Play', appUrl: 'https://game.freegamestore.online' },
    async () => new Response('<html><head><title>Game</title></head></html>'),
  );
  assert.ok(problems.some((p) => p.includes('canonical')));
  assert.ok(problems.some((p) => p.includes('robots')));
  assert.ok(problems.some((p) => p.includes('sitemap')));
});
test('SEO sweep rejects origins outside hosted games', async () => {
  await assert.rejects(auditGame({ appUrl: 'https://example.com' }), /Invalid hosted/);
});

test('SEO sweep accepts authored card layouts and detects missing or duplicate directives', async () => {
  const canonical = 'https://game.freegamestore.online/';
  const game = { name: 'Game', description: 'Play', appUrl: canonical };
  const root = '<title>Game – Free Game Store</title><meta name="description" content="Play">' +
    `<link rel="canonical" href="${canonical}">` +
    '<meta property="og:title" content="Game – Free Game Store"><meta property="og:description" content="Play">' +
    `<meta property="og:url" content="${canonical}">` +
    '<meta property="og:type" content="website"><meta property="og:site_name" content="Free Game Store">' +
    '<meta name="twitter:title" content="Game – Free Game Store"><meta name="twitter:description" content="Play">';
  const check = (card) => auditGame(game, async (url) => new Response(url.pathname === '/robots.txt'
    ? `User-agent: *\nAllow: /\nSitemap: ${canonical}sitemap.xml\n`
    : url.pathname === '/sitemap.xml'
      ? `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${canonical}</loc></url></urlset>`
      : `<html><head>${root}${card}</head></html>`));
  for (const card of [
    '<meta name="twitter:card" content="summary">',
    '<meta content="summary_large_image" name="twitter:card">',
    "<meta NAME='twitter:card' CONTENT='player'>",
    '<meta name=twitter:card content=app>',
  ]) assert.deepEqual(await check(card), []);
  for (const card of ['', '<meta name="twitter:card" content=" ">', '<meta name="twitter:card" content="summary"><meta name="twitter:card" content="summary_large_image">'])
    assert.ok((await check(card)).some((problem) => problem.includes('twitter:card')));
});
