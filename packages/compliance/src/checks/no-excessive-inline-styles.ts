import type { FileSource } from '../lib/file-source.js';
import { extOf } from '../lib/path.js';
import { stripCommentsAndStrings } from '../lib/strip.js';
import type { CheckResult } from '../types.js';

/**
 * Flags excessive use of React inline style objects (`style={{ ... }}`)
 * in TSX files under web/src/. Some inline styles are fine — dynamic
 * values, canvas positioning, animation transforms. But heavy reliance
 * on `style={{` means the game isn't leveraging Tailwind CSS or the
 * design system, making theming and dark mode harder.
 *
 * Thresholds:
 *   - Any single file with > 15 inline style objects → warn
 *   - Total across all TSX files > 30 → warn
 *
 * Strips comments before scanning. Excludes test files.
 *
 * WARN level — guidelines, not a hard gate.
 */

const PER_FILE_THRESHOLD = 15;
const TOTAL_THRESHOLD = 30;

const INLINE_STYLE_RE = /\bstyle\s*=\s*\{\{/g;

function isTestFile(path: string): boolean {
  return /\.(?:test|spec)\.[jt]sx?$/.test(path) || /(?:^|\/)(?:test|tests|__tests__)\//.test(path);
}

export async function checkNoExcessiveInlineStyles(source: FileSource): Promise<CheckResult> {
  let totalCount = 0;
  const heavyFiles: { file: string; count: number }[] = [];
  let fileCount = 0;

  for await (const path of source.list()) {
    if (!path.startsWith('web/src/')) continue;
    if (extOf(path) !== '.tsx') continue;
    if (isTestFile(path)) continue;

    const raw = await source.read(path);
    if (!raw) continue;

    const stripped = stripCommentsAndStrings(raw);
    const matches = stripped.match(INLINE_STYLE_RE);
    const count = matches ? matches.length : 0;

    if (count > 0) {
      totalCount += count;
      fileCount++;
      if (count > PER_FILE_THRESHOLD) {
        heavyFiles.push({ file: path, count });
      }
    }
  }

  const perFileViolation = heavyFiles.length > 0;
  const totalViolation = totalCount > TOTAL_THRESHOLD;

  if (!perFileViolation && !totalViolation) {
    return {
      name: 'No excessive inline styles',
      status: 'pass',
      detail: `${totalCount} inline style(s) across ${fileCount} TSX file(s) (thresholds: ${PER_FILE_THRESHOLD}/file, ${TOTAL_THRESHOLD} total)`,
    };
  }

  const parts: string[] = [];
  if (totalViolation) {
    parts.push(`${totalCount} total inline styles (threshold: ${TOTAL_THRESHOLD})`);
  }
  if (perFileViolation) {
    parts.push(
      `${heavyFiles.length} file(s) exceed ${PER_FILE_THRESHOLD}/file: ${heavyFiles
        .slice(0, 3)
        .map((h) => `${h.file} (${h.count})`)
        .join(', ')}${heavyFiles.length > 3 ? '...' : ''}`,
    );
  }

  return {
    name: 'No excessive inline styles',
    status: 'warn',
    detail: parts.join('; '),
    suggestions: [
      'Replace inline style objects with Tailwind CSS utility classes where possible.',
      'Keep inline styles for truly dynamic values (e.g. computed positions, animation transforms).',
    ],
  };
}
