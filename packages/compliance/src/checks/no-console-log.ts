import type { FileSource } from '../lib/file-source.js';
import { stripCommentsAndStrings } from '../lib/strip.js';
import type { CheckResult } from '../types.js';

/**
 * Flags `console.log()` calls in game source files. Production games
 * should not ship with debug logging — it clutters the browser console
 * and can leak internal state to curious players.
 *
 * `console.error` and `console.warn` are deliberately excluded — those
 * are legitimate runtime diagnostics that help in production debugging.
 *
 * WARN level. Not a hard fail — some games log performance stats or
 * frame timing intentionally. The goal is visibility.
 *
 * Exclusions:
 *   - `web/src/test/` — test files may log freely
 */

const SCAN_EXTS = new Set(['.ts', '.tsx']);

function extOf(path: string): string {
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  return dot > slash ? path.slice(dot).toLowerCase() : '';
}

export async function checkNoConsoleLog(source: FileSource): Promise<CheckResult> {
  let totalCount = 0;
  const hitFiles: string[] = [];

  for await (const path of source.list()) {
    if (!path.startsWith('web/src/')) continue;
    if (path.startsWith('web/src/test/')) continue;
    if (!SCAN_EXTS.has(extOf(path))) continue;

    const raw = await source.read(path);
    if (!raw) continue;

    // Strip comments and strings so we don't flag console.log inside
    // a comment or a string literal like 'use console.log for debug'.
    const stripped = stripCommentsAndStrings(raw);

    const matches = stripped.match(/\bconsole\.log\s*\(/g);
    if (matches && matches.length > 0) {
      totalCount += matches.length;
      hitFiles.push(path);
    }
  }

  if (totalCount === 0) {
    return {
      name: 'No console.log',
      status: 'pass',
      detail: 'no console.log() calls found in web/src/',
    };
  }

  return {
    name: 'No console.log',
    status: 'warn',
    detail: `${totalCount} console.log() call(s) across ${hitFiles.length} file(s): ${hitFiles
      .slice(0, 5)
      .join(', ')}${hitFiles.length > 5 ? '...' : ''}`,
    suggestions: [
      'Remove debug logging before publishing. Use console.error or console.warn for runtime diagnostics that should stay.',
      'If the logging is intentional (e.g. performance stats), consider gating it behind a DEBUG flag.',
    ],
  };
}
