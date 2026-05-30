import type { FileSource } from '../lib/file-source.js';
import { stripCommentsOnly } from '../lib/strip.js';
import type { CheckResult } from '../types.js';

/**
 * Flags fetch() and XMLHttpRequest calls to external domains in game
 * source files. Games on the free tier must be self-contained — external
 * API calls violate both the privacy mandate (data leaves the platform)
 * and the offline/PWA mandate (game breaks without network).
 *
 * Allowed origins:
 *   - Relative URLs (`fetch('/api/...')`)
 *   - freegamestore.online (and subdomains)
 *   - freeappstore.online (and subdomains)
 *   - localhost / 127.0.0.1 (dev)
 *
 * Scans .ts and .tsx files under web/src/. Strips comments before
 * scanning so commented-out fetches don't trigger false positives.
 * String contents are preserved — the URLs we're looking for live
 * inside string literals.
 *
 * ERROR level — external fetches are a hard compliance gate.
 */

const SCAN_EXTS = new Set(['.ts', '.tsx']);

const ALLOWED_DOMAINS = ['freegamestore.online', 'freeappstore.online', 'localhost', '127.0.0.1'];

/** Check if a URL string points to an allowed domain. */
function isAllowedUrl(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return true; // can't parse — not a real URL, skip
  }
  for (const allowed of ALLOWED_DOMAINS) {
    if (hostname === allowed || hostname.endsWith(`.${allowed}`)) return true;
  }
  return false;
}

function extOf(path: string): string {
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  return dot > slash ? path.slice(dot).toLowerCase() : '';
}

export async function checkNoExternalFetch(source: FileSource): Promise<CheckResult> {
  const hits: { file: string; url: string }[] = [];

  // Match fetch('https://...'), fetch("https://..."), fetch(`https://...`)
  const fetchRe = /\bfetch\s*\(\s*['"`](https?:\/\/[^'"`\s)]+)/g;

  // Match XMLHttpRequest .open() with external URLs
  const xhrOpenRe = /\.open\s*\(\s*['"][A-Z]+['"]\s*,\s*['"`](https?:\/\/[^'"`\s)]+)/g;

  // Match new XMLHttpRequest (just flag the presence together with open)
  const xhrNewRe = /\bnew\s+XMLHttpRequest\b/;

  for await (const path of source.list()) {
    if (!path.startsWith('web/src/')) continue;
    if (!SCAN_EXTS.has(extOf(path))) continue;

    const raw = await source.read(path);
    if (!raw) continue;

    // Strip comments but keep strings — URLs live in strings.
    const content = stripCommentsOnly(raw);

    for (const match of content.matchAll(fetchRe)) {
      const url = match[1]!;
      if (!isAllowedUrl(url)) {
        hits.push({ file: path, url: url.length > 60 ? `${url.slice(0, 57)}...` : url });
      }
    }

    // Only check XHR .open() calls if the file also creates an XMLHttpRequest.
    if (xhrNewRe.test(content)) {
      for (const match of content.matchAll(xhrOpenRe)) {
        const url = match[1]!;
        if (!isAllowedUrl(url)) {
          hits.push({ file: path, url: url.length > 60 ? `${url.slice(0, 57)}...` : url });
        }
      }
    }
  }

  if (hits.length === 0) {
    return {
      name: 'No external fetch',
      status: 'pass',
      detail: 'no fetch() or XMLHttpRequest calls to external domains in web/src/',
    };
  }

  return {
    name: 'No external fetch',
    status: 'fail',
    detail: `${hits.length} external fetch(es): ${hits
      .slice(0, 3)
      .map((h) => `${h.file} → ${h.url}`)
      .join('; ')}${hits.length > 3 ? '...' : ''}`,
    suggestions: [
      'Remove external API calls. Games must be self-contained and work offline.',
      'If the game needs server data, route it through the platform API (api.freegamestore.online).',
    ],
  };
}
