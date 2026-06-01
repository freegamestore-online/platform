import type { FileSource } from '../lib/file-source.js';
import { stripHtmlComments } from '../lib/strip.js';
import type { CheckResult } from '../types.js';

const HTML_PATH = 'web/index.html';

/**
 * Verifies `web/index.html` declares the basics: a `lang` attribute, a
 * viewport meta (that disables pinch/double-tap zoom), and a non-empty
 * `<title>`. These cover:
 *
 *   - lang   → screen readers + auto-translate work correctly
 *   - viewport → mobile rendering is sized to device, not desktop default,
 *                AND zoom is disabled so taps during gameplay don't
 *                accidentally pinch/double-tap-zoom the board
 *   - title  → the only thing visible in tabs, history, search results
 *
 * All of these are baked into the canonical templates — this check exists
 * to catch creators (and the VibeCode agent) who edited index.html and
 * accidentally stripped something they needed. Both creation paths run
 * this check: `runChecks` (CLI/CI) and `runChecksFromFiles` (VibeCode).
 */
export async function checkHtmlMeta(source: FileSource): Promise<CheckResult> {
  const rawHtml = await source.read(HTML_PATH);
  if (rawHtml === null) {
    return {
      name: 'HTML meta tags',
      status: 'fail',
      detail: `${HTML_PATH} not found`,
    };
  }
  // Strip HTML comment bodies before matching — `<!-- <meta name=
  // "viewport" ...> -->` is not a real viewport meta, and a commented-
  // out `<title>` shouldn't count either.
  const html = stripHtmlComments(rawHtml);

  const missing: string[] = [];
  if (!/<html[^>]*\blang\s*=/i.test(html)) missing.push('lang attribute on <html>');
  // Grab the whole viewport tag so we can inspect its `content` too.
  const viewportTag = html.match(/<meta[^>]*\bname\s*=\s*["']viewport["'][^>]*>/i)?.[0];
  if (!viewportTag) {
    missing.push('viewport meta');
  } else if (!disablesZoom(viewportTag)) {
    // Either form disables pinch/double-tap zoom; `user-scalable=no` is
    // the canonical one used across the storefront.
    missing.push('viewport must disable zoom (add user-scalable=no)');
  }
  // Extract the <title> body (multiline-safe), trim, and require it
  // be non-empty. Avoids rejecting valid titles like `<title> Hello</title>`
  // where the body has leading whitespace.
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (!titleMatch || titleMatch[1]!.trim() === '') missing.push('non-empty <title>');

  if (missing.length === 0) {
    return { name: 'HTML meta tags', status: 'pass', detail: 'lang + viewport (zoom disabled) + title present' };
  }
  return {
    name: 'HTML meta tags',
    status: 'fail',
    detail: `missing: ${missing.join(', ')}`,
    suggestions: [
      'Restore the canonical <head>: `<html lang="en">`, `<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no" />`, `<title>App name</title>`.',
    ],
  };
}

/** True if a viewport meta tag disables pinch/double-tap zoom. */
function disablesZoom(viewportTag: string): boolean {
  return (
    /user-scalable\s*=\s*(no|0)/i.test(viewportTag) ||
    /maximum-scale\s*=\s*1(\.0+)?\b/i.test(viewportTag)
  );
}
