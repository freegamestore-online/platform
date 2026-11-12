import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { renderAssistants } = require('../lib/assistants.cjs');
const clients = require('../data/ai-assistants.json');
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('directory badges require explicit live status and an HTTPS listing URL', () => {
  const client = clients[0];
  for (const listing of [undefined, { live: false, url: 'https://example.com/listing' }, { live: true }, { live: true, url: 'javascript:alert(1)' }]) {
    assert.doesNotMatch(renderAssistants([{ ...client, listing }]), /Directory listing live/);
  }
  const html = renderAssistants([{ ...client, listing: { live: true, url: 'https://example.com/listing' } }]);
  assert.match(html, /href="https:\/\/example.com\/listing">Directory listing live/);
  const hostile = renderAssistants([{ ...client, name: '<script>bad</script>', steps: ['<img src=x onerror=bad>'], snippet: '</code><script>bad</script>' }]);
  assert.doesNotMatch(hostile, /<script>|<img/);
  assert.match(hostile, /&lt;script&gt;/);
});

test('build ships discoverable connector, support and privacy pages with badges hidden', () => {
  const dist = mkdtempSync(join(tmpdir(), 'fgs-assistants-'));
  try {
    execFileSync(process.execPath, [fileURLToPath(new URL('../build.js', import.meta.url))], {
      env: { ...process.env, FGS_DIST: dist }, timeout: 60_000, stdio: 'pipe',
    });
    const page = readFileSync(join(dist, 'build-with-ai.html'), 'utf8');
    assert.match(page, /id="ai-assistants"/);
    assert.doesNotMatch(page, /\{\{AI_ASSISTANTS\}\}|Directory listing live/);
    assert.equal(clients.length, 8);
    for (const client of clients) {
      assert.match(page, new RegExp(`id="assistant-${client.id}"`));
      assert.ok(client.steps.length >= 2 && client.steps.length <= 3);
    }
    assert.match(page, /claude mcp add --transport http freegamestore https:\/\/mcp.freegamestore.online\/mcp/);
    assert.match(readFileSync(join(dist, 'index.html'), 'utf8'), /href="\/build-with-ai#ai-assistants"/);
    const support = readFileSync(join(dist, 'support.html'), 'utf8');
    assert.match(support, /platform\/issues\/new/);
    assert.match(support, /href="\/signout"/);
    assert.match(support, /rel="canonical" href="https:\/\/freegamestore.online\/support"/);
    assert.match(readFileSync(join(dist, 'sitemap.xml'), 'utf8'), /<loc>https:\/\/freegamestore.online\/support<\/loc>/);
    const privacy = readFileSync(join(dist, 'privacy.html'), 'utf8');
    for (const evidence of ['id="mcp"', '30-day', '90 days', 'Cloudflare', 'GitHub', 'agent_build', '/signout', '/support']) assert.ok(privacy.includes(evidence), evidence);
    assert.doesNotMatch(privacy, /no data whatsoever|collect: nothing/);
    assert.match(readFileSync(join(dist, 'terms.html'), 'utf8'), /MCP connector and creator services/);
    for (const file of ['llms.txt', 'SKILLS.md', 'skills.md']) assert.match(readFileSync(join(dist, file), 'utf8'), /https:\/\/freegamestore.online\/docs\/mcp\//);
    assert.match(read('docs/astro.config.mjs'), /slug: 'mcp'/);
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});
