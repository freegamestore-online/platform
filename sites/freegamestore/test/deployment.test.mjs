import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyDist } from '../scripts/verify-dist.mjs';
import { verifyLiveSeo, verifyLegacyRedirects, verifyLiveDeployment } from '../scripts/verify-seo.mjs';

test('deployment verification tolerates brief propagation but fails persistent stale metadata', async () => {
  const urls = ['/games/2048', '/u/serge-ivo', '/ai/codex'].map((route) => `https://freegamestore.online${route}`);
  let sweeps = 0;
  const fetchPage = async (url) => {
    if (url.endsWith('/sitemap.xml')) {
      sweeps++;
      return new Response(`<urlset>${urls.map((entry) => `<url><loc>${entry}</loc></url>`).join('')}</urlset>`);
    }
    if (url.endsWith('.html')) return new Response('', { status: 301, headers: { location: url.slice(0, -5) } });
    const canonical = sweeps === 1 ? `${url}.html` : url;
    return new Response(`<link rel="canonical" href="${canonical}"><meta property="og:url" content="${url}"><script type="application/ld+json">{"url":"${url}"}</script>`);
  };
  await verifyLiveDeployment(urls, { fetchPage, attempts: 2, retryDelay: 0 });
  assert.equal(sweeps, 2, 'Must check the complete sitemap again after propagation');
  sweeps = 0;
  await assert.rejects(verifyLiveDeployment(urls, { fetchPage, attempts: 1, retryDelay: 0 }), /canonical disagreement/);
  await assert.rejects(verifyLiveDeployment(urls, {
    fetchPage: async () => new Response('', { status: 503 }), attempts: 2, retryDelay: 0,
  }), /direct HTTP 200/);
});

test('live SEO verification checks game, author and guide URLs directly and rejects redirects or canonical disagreement', async () => {
  const urls = ['/games/2048', '/u/serge-ivo', '/ai/codex'].map((route) => `https://freegamestore.online${route}`);
  const calls = [];
  const html = (url) => `<link rel="canonical" href="${url}"><meta property="og:url" content="${url}"><script type="application/ld+json">{"url":"${url}"}</script>`;
  await verifyLiveSeo(urls, async (url, options) => {
    calls.push(url);
    assert.equal(options.redirect, 'manual');
    return new Response(html(url));
  });
  assert.deepEqual(calls.sort(), [...urls].sort());
  await assert.rejects(verifyLiveSeo(urls, async () => new Response('', { status: 301 })), /direct HTTP 200/);
  await assert.rejects(verifyLiveSeo([urls[0]], async () => new Response(html(`${urls[0]}.html`))), /canonical disagreement/);
  await verifyLegacyRedirects(urls, async (url, options) => {
    assert.equal(options.redirect, 'manual');
    assert.ok(url.endsWith('.html'));
    return new Response('', { status: 301, headers: { location: url.slice(0, -5) } });
  });
  await assert.rejects(verifyLegacyRedirects(urls, async () => new Response('')), /permanent redirect/);
});

test('deployment rejects absent docs and missing docs assets', () => {
  const dist = mkdtempSync(join(tmpdir(), 'fgs-deploy-'));
  const put = (file, content = '') => {
    const path = join(dist, file);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
  };
  try {
    for (const file of ['index.html', 'style.css', '_headers', '_redirects']) put(file);
    assert.throws(() => verifyDist(dist), /docs\/index.html/);
    put('docs/index.html', '<link href="/docs/_astro/main.css" rel="stylesheet">');
    put('docs/sdk/overview/index.html');
    assert.throws(() => verifyDist(dist), /Missing docs asset/);
    put('docs/_astro/main.css', 'body{}');
    assert.doesNotThrow(() => verifyDist(dist));
    put('docs/index.html', '<html>unbuilt docs</html>');
    assert.throws(() => verifyDist(dist), /no built CSS\/JS/);
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

test('production workflow gates upload on storefront tests and combined SDK docs build', () => {
  const workflow = readFileSync(new URL('../../../.github/workflows/deploy-storefront.yml', import.meta.url), 'utf8');
  const commands = ['npm test', 'npm run build', 'pnpm --dir docs install --frozen-lockfile --ignore-workspace',
    'npm --prefix docs run build', 'node scripts/verify-dist.mjs', 'node scripts/verify-seo.mjs', 'npx wrangler pages deploy dist', 'node scripts/verify-seo.mjs --live'];
  let previous = -1;
  for (const command of commands) {
    const position = workflow.indexOf(`run: ${command}`);
    assert.ok(position > previous, `${command} must run in order before deployment`);
    previous = position;
  }
  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /if: github.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /sites\/freegamestore\/\*\*/);
  assert.match(workflow, /--project-name=freegamestore --branch=main --commit-hash=\$\{\{ github.sha \}\}/);
  assert.doesNotMatch(workflow, /continue-on-error:/);
});
