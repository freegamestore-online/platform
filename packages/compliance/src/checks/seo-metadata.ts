import type { FileSource } from '../lib/file-source.js';
import { stripHtmlComments } from '../lib/strip.js';
import type { CheckResult } from '../types.js';

/** Warning only: the shared host supplies approved metadata at runtime. */
export async function checkSeoMetadata(source: FileSource): Promise<CheckResult> {
  const raw = await source.read('web/index.html');
  if (raw === null) return { name: 'SEO metadata', status: 'pass', detail: 'no web/index.html' };
  const html = stripHtmlComments(raw);
  const missing = ['description', 'twitter:card', 'twitter:title', 'twitter:description'].filter(
    (name) => !new RegExp(`<meta\\b[^>]*\\bname\\s*=\\s*["']${name}["'][^>]*>`, 'i').test(html),
  );
  for (const name of ['og:title', 'og:description', 'og:url', 'og:type', 'og:site_name']) {
    if (!new RegExp(`<meta\\b[^>]*\\bproperty\\s*=\\s*["']${name}["'][^>]*>`, 'i').test(html))
      missing.push(name);
  }
  if (!/<link\b[^>]*\brel\s*=\s*["']canonical["'][^>]*>/i.test(html)) missing.push('canonical');
  return {
    name: 'SEO metadata',
    status: missing.length ? 'warn' : 'pass',
    detail: missing.length
      ? `Missing source defaults: ${missing.join(', ')}. The shared host supplies approved public-game metadata; keep the template defaults for other hosting.`
      : 'Canonical, description and social metadata defaults present',
  };
}
