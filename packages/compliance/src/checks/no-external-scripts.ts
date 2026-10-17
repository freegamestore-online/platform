import type { FileSource } from '../lib/file-source.js';
import { stripHtmlComments } from '../lib/strip.js';
import type { CheckResult } from '../types.js';

const INDEX_HTML = 'web/index.html';

// Domains allowed in <script src="..."> tags: the font CDNs the storefront relies on.
const ALLOWED_DOMAINS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);

// The one platform-owned script a game may load: the analytics loader, which
// injects the store's analytics tags under policy. Matched by exact host AND path.
// A broader freegamestore.online match would let one game's subdomain serve a
// script under the platform's name, and games are untrusted user content.
const PLATFORM_LOADER_HOST = 'api.freegamestore.online';
const PLATFORM_LOADER_PATH = '/v1/analytics.js';

/**
 * External scripts introduce supply-chain risk and can exfiltrate player
 * data. Only platform-approved domains are allowed in `<script src>` tags
 * inside `web/index.html`.
 *
 * Allowed: fonts.googleapis.com, fonts.gstatic.com, and the platform
 * analytics loader (https://api.freegamestore.online/v1/analytics.js).
 * Everything else fails.
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

    if (isPlatformLoader(src)) continue;

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
      'Analytics: use the platform loader, <script src="https://api.freegamestore.online/v1/analytics.js?app=<id>" defer>, not a direct tracker.',
      `Allowed domains: ${[...ALLOWED_DOMAINS].join(', ')}, plus the platform analytics loader.`,
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

/** True only for the platform analytics loader: its exact host and path. */
function isPlatformLoader(url: string): boolean {
  const cleaned = url.startsWith('//') ? `https:${url}` : url;
  try {
    const u = new URL(cleaned);
    return u.hostname.toLowerCase() === PLATFORM_LOADER_HOST && u.pathname === PLATFORM_LOADER_PATH;
  } catch {
    return false;
  }
}

/** Check if hostname or any parent domain matches the allow list. */
function isAllowed(hostname: string): boolean {
  if (ALLOWED_DOMAINS.has(hostname)) return true;
  // Subdomains of an allowed font CDN.
  for (const allowed of ALLOWED_DOMAINS) {
    if (hostname.endsWith(`.${allowed}`)) return true;
  }
  return false;
}
