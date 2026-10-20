import type { FileSource } from '../lib/file-source.js';
import { extOf } from '../lib/path.js';
import { stripCommentsOnly } from '../lib/strip.js';
import type { CheckResult } from '../types.js';

/**
 * Flags hardcoded hex color values in TSX files (React components).
 * Games should use CSS custom properties (`var(--accent)`, `var(--ink)`,
 * etc.) for UI chrome so the storefront can theme consistently and dark
 * mode works out of the box.
 *
 * Only scans .tsx files — plain .ts files are likely canvas/game-engine
 * logic where hardcoded colors for sprites, particles, and effects are
 * expected and correct.
 *
 * Threshold: warn if total hex colors across all TSX files > 10.
 *
 * Strips comments and strings that are CSS variable definitions
 * (like `--accent: #10b981`) before counting. The remaining hex values
 * are likely inline styles or className-adjacent color specs that should
 * use design tokens.
 *
 * WARN level — not a hard gate, but a strong signal the game isn't
 * leveraging the design system.
 */

const THRESHOLD = 10;

/** Match 6-digit or 3-digit hex colors: #rrggbb or #rgb. */
const HEX_COLOR_RE = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;

/** Lines that define CSS custom properties — these are fine. */
const CSS_VAR_DEF_RE = /--[\w-]+\s*:\s*#/;

export async function checkNoHardcodedColors(source: FileSource): Promise<CheckResult> {
  let totalCount = 0;
  const hitFiles: string[] = [];

  for await (const path of source.list()) {
    if (!path.startsWith('web/src/')) continue;
    if (extOf(path) !== '.tsx') continue;

    const raw = await source.read(path);
    if (!raw) continue;

    // Strip comments but keep strings — hex colors in inline styles
    // like style={{ color: '#ff0000' }} are the thing we're checking.
    const stripped = stripCommentsOnly(raw);

    // Count hex colors line by line, skipping CSS variable definitions.
    let fileCount = 0;
    for (const line of stripped.split('\n')) {
      if (CSS_VAR_DEF_RE.test(line)) continue;
      const matches = line.match(HEX_COLOR_RE);
      if (matches) fileCount += matches.length;
    }

    if (fileCount > 0) {
      totalCount += fileCount;
      hitFiles.push(path);
    }
  }

  if (totalCount <= THRESHOLD) {
    return {
      name: 'No hardcoded colors',
      status: 'pass',
      detail: `${totalCount} hex color(s) in TSX files (threshold: ${THRESHOLD})`,
    };
  }

  return {
    name: 'No hardcoded colors',
    status: 'warn',
    detail: `${totalCount} hex color(s) across ${hitFiles.length} TSX file(s): ${hitFiles
      .slice(0, 5)
      .join(', ')}${hitFiles.length > 5 ? '...' : ''}`,
    suggestions: [
      'Replace hardcoded hex colors with CSS custom properties: var(--accent), var(--ink), var(--surface), etc.',
      'Canvas drawing code belongs in .ts files (not .tsx) where hardcoded colors are expected.',
    ],
  };
}
