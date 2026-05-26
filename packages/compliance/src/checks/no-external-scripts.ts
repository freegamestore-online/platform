import type { FileSource } from '../lib/file-source.js';
import { stripHtmlComments } from '../lib/strip.js';
import type { CheckResult } from '../types.js';

const INDEX_HTML = 'web/index.html';

// Domains allowed in <script src="..."> tags. These are platform-owned
// or universally trusted CDNs that the storefront relies on.
const ALLOWED_DOMAINS = new Set([
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'static.cloudflareinsights.com',
  'freegamestore.online',
  'freeappstore.online',
]);

/**
 * External scripts introduce supply-chain risk and can exfiltrate player
 * data. Only platform-approved domains are allowed in `<script src>` tags
 * inside `web/index.html`.
 *
 * Allowed: fonts.googleapis.com, fonts.gstatic.com,
 * static.cloudflareinsights.com, freegamestore.online,
 * freeappstore.online. Everything else fails.
 *
 * HTML comments are stripped first so `<!-- <script src="..."> -->` blocks
 * don't trigger false positives.
 */
export async function checkNoExternalScripts(source: FileSource): Promise<CheckResult> {
  const raw = await source.read(INDEX_HTML);
  if (raw === null) {
    return {
      name: 'No external scripts',
      status: 'pass',
      detail: 'no web/index.html (not a web project)',
    };
  }

  const html = stripHtmlComments(raw);

  // Match <script ... src="..." ...> tags. The src value can use single
  // or double quotes.
  const scriptSrcRe = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  const violations: string[] = [];

  for (const match of html.matchAll(scriptSrcRe)) {
    const src = match[1] ?? '';

    // Relative or protocol-relative paths that don't point to an external
    // domain are fine (local bundles, Vite-injected scripts, etc.).
    if (!src.startsWith('http://') && !src.startsWith('https://') && !src.startsWith('//')) {
      continue;
    }

    // Extract the hostname from the URL.
    const hostname = extractHostname(src);
    if (hostname === null) continue;

    // Check if the hostname (or any parent domain) is in the allow list.
    if (isAllowed(hostname)) continue;

    violations.push(src.length > 80 ? `${src.slice(0, 77)}...` : src);
  }

  if (violations.length === 0) {
    return {
      name: 'No external scripts',
      status: 'pass',
      detail: 'no disallowed external script sources in index.html',
    };
  }

  return {
    name: 'No external scripts',
    status: 'fail',
    detail: `${violations.length} external script(s) from disallowed domains: ${violations.slice(0, 3).join(', ')}${violations.length > 3 ? '...' : ''}`,
    suggestions: [
      'Remove external <script src="..."> tags or self-host the scripts under web/public/.',
      `Allowed domains: ${[...ALLOWED_DOMAINS].join(', ')}.`,
    ],
  };
}

function extractHostname(url: string): string | null {
  // Handle protocol-relative URLs (//example.com/...).
  const cleaned = url.startsWith('//') ? `https:${url}` : url;
  try {
    return new URL(cleaned).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Check if hostname or any parent domain matches the allow list. */
function isAllowed(hostname: string): boolean {
  if (ALLOWED_DOMAINS.has(hostname)) return true;
  // Allow subdomains of allowed domains (e.g. api.freegamestore.online).
  for (const allowed of ALLOWED_DOMAINS) {
    if (hostname.endsWith(`.${allowed}`)) return true;
  }
  return false;
}
