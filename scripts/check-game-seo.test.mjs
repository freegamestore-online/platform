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
