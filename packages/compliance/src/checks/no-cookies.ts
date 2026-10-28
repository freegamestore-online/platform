import type { FileSource } from '../lib/file-source.js';
import { extOf } from '../lib/path.js';
import { stripCommentsForExt } from '../lib/strip.js';
import type { CheckResult } from '../types.js';

// Patterns that indicate cookie usage — either the native DOM API or
// popular helper libraries. Each pattern is SDK-specific enough to avoid
// false positives against bare English words.
const COOKIE_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: 'document.cookie', pattern: /\bdocument\s*\.\s*cookie\b/i },
  { name: 'js-cookie', pattern: /from\s+['"]js-cookie['"]/i },
  { name: 'js-cookie (require)', pattern: /require\(['"]js-cookie['"]\)/i },
  { name: 'cookie-parser', pattern: /from\s+['"]cookie-parser['"]/i },
  { name: 'cookie-parser (require)', pattern: /require\(['"]cookie-parser['"]\)/i },
  { name: 'Cookies.set', pattern: /\bCookies\s*\.\s*set\s*\(/i },
  { name: 'Cookies.get', pattern: /\bCookies\s*\.\s*get\s*\(/i },
];

const SCAN_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.html']);

/**
 * Reports cookie usage. A first-party cookie on the game's own origin is
 * equivalent to localStorage (platform#373), so this warns instead of
 * failing. localStorage or the platform KV SDK is still the better home
 * for player data. Cross-site tracking stays a hard fail in `no-tracking`.
 *
 * Scans source files for `document.cookie`, js-cookie, cookie-parser,
 * and `Cookies.set`/`Cookies.get` patterns. Comments are stripped
 * before scanning to avoid false positives from documentation.
 */
export async function checkNoCookies(source: FileSource): Promise<CheckResult> {
  const hits: { file: string; matches: string[] }[] = [];

  for await (const path of source.list()) {
    const ext = extOf(path);
    if (!SCAN_EXTS.has(ext)) continue;
    const raw = await source.read(path);
    if (!raw) continue;
    const content = stripCommentsForExt(raw, ext);
    const matches = COOKIE_PATTERNS.filter((p) => p.pattern.test(content)).map((p) => p.name);
    if (matches.length > 0) {
      hits.push({ file: path, matches });
    }
  }

  if (hits.length === 0) {
    return {
      name: 'No cookies',
      status: 'pass',
      detail: 'no cookie usage found — player data stays in localStorage',
    };
  }

  return {
    name: 'No cookies',
    status: 'warn',
    detail: `${hits.length} file(s) use cookies: ${hits
      .slice(0, 3)
      .map((h) => `${h.file} (${h.matches.join(', ')})`)
      .join('; ')}${hits.length > 3 ? '...' : ''}`,
    suggestions: [
      'First-party cookies are allowed, but localStorage or the platform KV SDK (@freegamestore/games provides app.kv for per-user storage) is simpler and is not sent to the server on every request.',
      'Do not use cookies to track players across sites. Trackers still fail the platform loader check.',
    ],
  };
}
