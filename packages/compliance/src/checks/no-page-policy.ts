import type { FileSource } from '../lib/file-source.js';
import { stripHtmlComments } from '../lib/strip.js';
import type { CheckResult } from '../types.js';

const INDEX_HTML = 'web/index.html';
const NAME = 'No page-level CSP';

/**
 * Warns when `web/index.html` sets its own Content-Security-Policy or
 * Permissions-Policy with `<meta http-equiv>` (#369).
 *
 * The game host already sends both headers, default-open. The browser applies
 * a page's meta policy on top of the header, so the stricter of the two wins:
 * a meta CSP can only take capabilities away. Three games had one copied from
 * the old platform lockdown, and it blocked the platform analytics loader
 * without anyone noticing.
 *
 * WARN level: a stricter policy is the creator's choice, but it should be a
 * deliberate one.
 */
export async function checkNoPagePolicy(source: FileSource): Promise<CheckResult> {
  const raw = await source.read(INDEX_HTML);
  if (raw === null) {
    return { name: NAME, status: 'pass', detail: 'no web/index.html (not a web project)' };
  }
  const html = stripHtmlComments(raw);
  const found = new Set<string>();
  for (const m of html.matchAll(/<meta\b[^>]*\bhttp-equiv\s*=\s*["']?([\w-]+)/gi)) {
    const name = (m[1] ?? '').toLowerCase();
    if (name === 'content-security-policy') found.add('Content-Security-Policy');
    if (name === 'permissions-policy' || name === 'feature-policy') found.add('Permissions-Policy');
  }
  if (found.size === 0) {
    return { name: NAME, status: 'pass', detail: 'index.html sets no page-level policy' };
  }
  const list = [...found].join(' and ');
  return {
    name: NAME,
    status: 'warn',
    detail: `web/index.html sets its own ${list} with <meta http-equiv>, which can only remove capabilities the host allows`,
    suggestions: [
      `Remove the <meta http-equiv> ${list} tag. The host already sends both headers for every game, default-open (platform#369).`,
      'If you keep a stricter CSP on purpose, allow https://api.freegamestore.online in script-src and connect-src, or the platform analytics loader is blocked.',
    ],
  };
}
