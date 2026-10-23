import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

export function sitemapUrls(xml) {
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  assert.ok(urls.length, 'Sitemap must contain URLs');
  assert.equal(new Set(urls).size, urls.length, 'Duplicate sitemap URLs');
  for (const url of urls) {
    assert.equal(new URL(url).origin, 'https://freegamestore.online');
    assert.ok(!new URL(url).pathname.endsWith('.html'), `Redirecting sitemap URL: ${url}`);
  }
  return urls;
}

export function verifyPage(url, html) {
  const canonicals = [...html.matchAll(/<link\b[^>]*rel="canonical"[^>]*href="([^"]+)"/g)];
  assert.equal(canonicals.length, 1, `${url}: expected one canonical`);
  assert.equal(canonicals[0][1], url, `${url}: canonical disagreement`);
  const og = [...html.matchAll(/<meta\b[^>]*property="og:url"[^>]*content="([^"]+)"/g)];
  for (const match of og) assert.equal(match[1], url, `${url}: og:url disagreement`);
  if (/\/(?:games|u|ai)\//.test(new URL(url).pathname)) {
    assert.equal(og.length, 1, `${url}: expected og:url`);
    const schemas = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    assert.ok(schemas.some((match) => match[1].includes(`"${url}"`)), `${url}: missing structured page identity`);
  }
}

export function verifyGeneratedSeo(dist, { includeDocs = true } = {}) {
  const urls = sitemapUrls(readFileSync(resolve(dist, 'sitemap.xml'), 'utf8'));
  for (const url of urls) {
    const pathname = new URL(url).pathname;
    // SDK docs are built separately after storefront generation.
    if (!includeDocs && pathname.startsWith('/docs/')) continue;
    const file = pathname.endsWith('/') ? `${pathname}index.html` : `${pathname}.html`;
    verifyPage(url, readFileSync(resolve(dist, `.${file}`), 'utf8'));
  }
  return urls;
}

export async function verifyLiveSeo(urls, fetchPage = fetch) {
  // Bound concurrency while checking every destination, without following redirects.
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(8, urls.length) }, async () => {
    while (next < urls.length) {
      const url = urls[next++];
      const response = await fetchPage(url, { redirect: 'manual', signal: AbortSignal.timeout(30000) });
      assert.equal(response.status, 200, `${url}: expected direct HTTP 200`);
      verifyPage(url, await response.text());
    }
  }));
}

export async function verifyLegacyRedirects(urls, fetchPage = fetch) {
  for (const prefix of ['/games/', '/u/', '/ai/']) {
    const url = urls.find((entry) => new URL(entry).pathname.startsWith(prefix));
    assert.ok(url, `Missing representative route: ${prefix}`);
    const response = await fetchPage(`${url}.html`, { redirect: 'manual', signal: AbortSignal.timeout(30000) });
    assert.ok([301, 308].includes(response.status), `${url}.html: expected permanent redirect`);
    assert.equal(new URL(response.headers.get('location'), url).href, url, `${url}.html: redirect target disagreement`);
  }
}

export async function verifyLiveDeployment(urls, { fetchPage = fetch, attempts = 6, retryDelay = 10000 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchPage('https://freegamestore.online/sitemap.xml', { redirect: 'manual', signal: AbortSignal.timeout(30000) });
      assert.equal(response.status, 200, 'Live sitemap must return direct HTTP 200');
      assert.deepEqual(sitemapUrls(await response.text()).sort(), [...urls].sort(), 'Deployed sitemap differs from generated sitemap');
      await verifyLiveSeo(urls, fetchPage);
      await verifyLegacyRedirects(urls, fetchPage);
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      console.warn(`Live SEO check ${attempt}/${attempts} failed; allowing deployment propagation before rechecking: ${error.message}`);
      await delay(retryDelay);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const urls = verifyGeneratedSeo(resolve('dist'));
  if (process.argv.includes('--live')) await verifyLiveDeployment(urls);
  console.log(`Verified SEO agreement for ${urls.length} sitemap URLs${process.argv.includes('--live') ? ' locally and live' : ''}`);
}
