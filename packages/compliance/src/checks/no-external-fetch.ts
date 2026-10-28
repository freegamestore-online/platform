import type { FileSource } from '../lib/file-source.js';
import { extOf } from '../lib/path.js';
import { stripCommentsOnly } from '../lib/strip.js';
import type { CheckResult } from '../types.js';

/**
 * Reports fetch(), XMLHttpRequest and WebSocket calls to external hosts in
 * game source files. The host lets a game reach any https host
 * (platform#369), so this is a visibility check, not a gate: data leaving
 * the platform should be visible in review. Offline behaviour is covered
 * by `pwa-offline`.
 *
 * Allowed origins (never reported):
 *   - Relative URLs (`fetch('/api/...')`)
 *   - freegamestore.online (and subdomains)
 *   - localhost / 127.0.0.1 (dev)
 *
 * Scans .ts and .tsx files under web/src/. Strips comments before
 * scanning so commented-out fetches don't trigger false positives.
 * String contents are preserved — the URLs we're looking for live
 * inside string literals.
 *
 * WARN level (platform#373) — each distinct external host is listed.
 */

const SCAN_EXTS = new Set(['.ts', '.tsx']);

const ALLOWED_DOMAINS = ['freegamestore.online', 'localhost', '127.0.0.1'];

/** Hostname of a URL string, or null when it can't be parsed. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Check if a URL string points to an allowed domain. */
function isAllowedUrl(url: string): boolean {
  const hostname = hostOf(url);
  if (hostname === null) return true; // can't parse — not a real URL, skip
  for (const allowed of ALLOWED_DOMAINS) {
    if (hostname === allowed || hostname.endsWith(`.${allowed}`)) return true;
  }
  return false;
}

export async function checkNoExternalFetch(source: FileSource): Promise<CheckResult> {
  const hits: { file: string; host: string }[] = [];

  // Match fetch('https://...'), fetch("https://..."), fetch(`https://...`)
  const fetchRe = /\bfetch\s*\(\s*['"`](https?:\/\/[^'"`\s)]+)/g;

  // Match new WebSocket('wss://...') and ('ws://...')
  const wsRe = /\bnew\s+WebSocket\s*\(\s*['"`](wss?:\/\/[^'"`\s)]+)/g;

  // Match XMLHttpRequest .open() with external URLs
  const xhrOpenRe = /\.open\s*\(\s*['"][A-Z]+['"]\s*,\s*['"`](https?:\/\/[^'"`\s)]+)/g;

  // Match new XMLHttpRequest (just flag the presence together with open)
  const xhrNewRe = /\bnew\s+XMLHttpRequest\b/;

  const record = (file: string, url: string): void => {
    const host = hostOf(url);
    if (host !== null && !isAllowedUrl(url)) hits.push({ file, host });
  };

  for await (const path of source.list()) {
    if (!path.startsWith('web/src/')) continue;
    if (!SCAN_EXTS.has(extOf(path))) continue;

    const raw = await source.read(path);
    if (!raw) continue;

    // Strip comments but keep strings — URLs live in strings.
    const content = stripCommentsOnly(raw);

    for (const match of content.matchAll(fetchRe)) record(path, match[1]!);
    for (const match of content.matchAll(wsRe)) record(path, match[1]!);

    // Only check XHR .open() calls if the file also creates an XMLHttpRequest.
    if (xhrNewRe.test(content)) {
      for (const match of content.matchAll(xhrOpenRe)) record(path, match[1]!);
    }
  }

  if (hits.length === 0) {
    return {
      name: 'No external fetch',
      status: 'pass',
      detail: 'no fetch() or XMLHttpRequest calls to external domains in web/src/',
    };
  }

  const hosts = [...new Set(hits.map((h) => h.host))].sort();
  const files = [...new Set(hits.map((h) => h.file))];

  return {
    name: 'No external fetch',
    status: 'warn',
    detail: `${hits.length} external request(s) to ${hosts.length} host(s): ${hosts.join(', ')} (in ${files
      .slice(0, 3)
      .join(', ')}${files.length > 3 ? '...' : ''})`,
    suggestions: [
      'Allowed, but visible: this game sends requests off-platform. Make sure the host is your own server or a public API, and send only the player data you need.',
      'The game should still work offline, or say so clearly when the network is unavailable (see the pwa-offline check).',
    ],
  };
}
