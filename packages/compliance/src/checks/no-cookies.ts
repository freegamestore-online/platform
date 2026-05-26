import type { FileSource } from '../lib/file-source.js';
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
 * All player data must stay in localStorage (or the platform KV SDK).
 * Cookies are not allowed — they leak data to servers on every request
 * and conflict with the cookieless analytics mandate.
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
    status: 'fail',
    detail: `${hits.length} file(s) use cookies: ${hits
      .slice(0, 3)
      .map((h) => `${h.file} (${h.matches.join(', ')})`)
      .join('; ')}${hits.length > 3 ? '...' : ''}`,
    suggestions: [
      'Replace cookie usage with localStorage or the platform KV SDK (@freegamestore/games provides app.kv for per-user storage).',
      'Cookies leak data to servers on every request and conflict with the platform cookieless analytics mandate.',
    ],
  };
}

function extOf(path: string): string {
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  return dot > slash ? path.slice(dot).toLowerCase() : '';
}
