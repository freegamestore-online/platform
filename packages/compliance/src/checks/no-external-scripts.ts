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

// A Subresource Integrity token: sha256/384/512 followed by a base64 digest.
const SRI_TOKEN_RE = /^sha(?:256|384|512)-[A-Za-z0-9+/_-]+={0,2}$/;

/**
 * External scripts introduce supply-chain risk and can exfiltrate player
 * data. The host's CSP allows scripts from any https origin (platform#369),
 * so the gate is Subresource Integrity (platform#373):
 *
 *   - Allowlisted (no report): fonts.googleapis.com, fonts.gstatic.com, and
 *     the platform analytics loader (https://api.freegamestore.online/v1/analytics.js).
 *   - WARN: a non-FGS https script that carries `integrity="sha256|384|512-…"`
 *     AND `crossorigin`. The warning lists the host so review can see it.
 *   - FAIL: any other external script: no `integrity`, an `integrity` without
 *     `crossorigin`, plain http, or a protocol-relative URL.
 *
 * Known trackers are a separate hard fail in `no-tracking`, which also
 * scans index.html.
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

  // Match whole <script ...> opening tags so integrity/crossorigin can be read
  // alongside src. Attribute values can use single or double quotes.
  const scriptTagRe = /<script\b[^>]*>/gi;
  const violations: string[] = [];
  const sriWarnings: string[] = [];

  for (const tagMatch of html.matchAll(scriptTagRe)) {
    const tag = tagMatch[0];
    const src = attr(tag, 'src');
    if (src === null) continue;

    // Relative paths that don't point to an external domain are fine (local
    // bundles, Vite-injected scripts, etc.).
    if (!src.startsWith('http://') && !src.startsWith('https://') && !src.startsWith('//')) {
      continue;
    }

    // Extract the hostname from the URL.
    const hostname = extractHostname(src);
    if (hostname === null) continue;

    if (isPlatformLoader(src)) continue;

    // Check if the hostname (or any parent domain) is in the allow list.
    if (isAllowed(hostname)) continue;

    const shown = src.length > 80 ? `${src.slice(0, 77)}...` : src;

    // Only an https script with valid SRI and crossorigin is acceptable.
    if (src.startsWith('https://')) {
      const integrity = attr(tag, 'integrity');
      const hasSri =
        integrity
          ?.trim()
          .split(/\s+/)
          .some((t) => SRI_TOKEN_RE.test(t)) ?? false;
      if (hasSri && hasAttr(tag, 'crossorigin')) {
        sriWarnings.push(hostname);
        continue;
      }
      violations.push(
        hasSri ? `${shown} (integrity without crossorigin)` : `${shown} (no integrity)`,
      );
      continue;
    }

    violations.push(`${shown} (${src.startsWith('http://') ? 'plain http' : 'protocol-relative'})`);
  }

  if (violations.length > 0) {
    return {
      name: 'No external scripts',
      status: 'fail',
      detail: `${violations.length} external script(s) without Subresource Integrity or over insecure transport: ${violations.slice(0, 3).join(', ')}${violations.length > 3 ? '...' : ''}`,
      suggestions: [
        'Add integrity="sha384-…" and crossorigin="anonymous" to the <script src="https://…"> tag (both are required), or self-host the script under web/public/. Plain http and protocol-relative URLs are not allowed.',
        'Analytics: use the platform loader, <script src="https://api.freegamestore.online/v1/analytics.js?app=<id>" defer>, not a direct tracker.',
        `Allowed without SRI: ${[...ALLOWED_DOMAINS].join(', ')}, plus the platform analytics loader.`,
      ],
    };
  }

  if (sriWarnings.length > 0) {
    const hosts = [...new Set(sriWarnings)].sort();
    return {
      name: 'No external scripts',
      status: 'warn',
      detail: `${sriWarnings.length} external script(s) with SRI from ${hosts.length} host(s): ${hosts.join(', ')}`,
      suggestions: [
        'Allowed because each carries integrity and crossorigin, but it is visible in review. Prefer self-hosting under web/public/ so the game works offline.',
      ],
    };
  }

  return {
    name: 'No external scripts',
    status: 'pass',
    detail: 'no disallowed external script sources in index.html',
  };
}

/** Value of an HTML attribute on a single tag, or null when absent. */
function attr(tag: string, name: string): string | null {
  const re = new RegExp(`(?<![\\w-])${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
  const m = re.exec(tag);
  return m ? (m[1] ?? m[2] ?? '') : null;
}

/** True when the tag has the attribute at all, valued or bare (`crossorigin`). */
function hasAttr(tag: string, name: string): boolean {
  return new RegExp(`(?<![\\w-])${name}(?![\\w-])`, 'i').test(tag);
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
