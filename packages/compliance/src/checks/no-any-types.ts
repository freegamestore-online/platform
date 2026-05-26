import type { FileSource } from '../lib/file-source.js';
import { stripCommentsAndStrings } from '../lib/strip.js';
import type { CheckResult } from '../types.js';

/**
 * Flags explicit `any` type annotations in game source files. Both
 * `: any` (parameter/return type) and `as any` (type assertion) are
 * counted — both are escape hatches that weaken type safety.
 *
 * This is a WARN, not a hard fail. Some third-party lib compat genuinely
 * requires `as any`, and the occasional `: any` parameter in an event
 * handler is pragmatic. The goal is visibility: developers should know
 * how many escape hatches they're carrying.
 *
 * Exclusions:
 *   - `web/src/test/` — test helpers often use loose typing
 *   - `web/src/types.ts` — type definition files may have legitimate `any`
 */

const SCAN_EXTS = new Set(['.ts', '.tsx']);

function extOf(path: string): string {
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  return dot > slash ? path.slice(dot).toLowerCase() : '';
}

function isExcluded(path: string): boolean {
  if (path.startsWith('web/src/test/')) return true;
  if (path === 'web/src/types.ts') return true;
  return false;
}

export async function checkNoAnyTypes(source: FileSource): Promise<CheckResult> {
  let totalCount = 0;
  const hitFiles: string[] = [];

  for await (const path of source.list()) {
    if (!path.startsWith('web/src/')) continue;
    if (!SCAN_EXTS.has(extOf(path))) continue;
    if (isExcluded(path)) continue;

    const raw = await source.read(path);
    if (!raw) continue;

    // Strip comments AND strings — `: any` inside a string literal
    // (e.g. a log message like 'cast to any') is not a real annotation.
    const stripped = stripCommentsAndStrings(raw);

    // Match `: any` (type annotation) and `as any` (type assertion).
    // Word boundaries prevent matching `canary`, `anyString`, etc.
    const matches = stripped.match(/(?::\s*any|as\s+any)\b/g);
    if (matches && matches.length > 0) {
      totalCount += matches.length;
      hitFiles.push(path);
    }
  }

  if (totalCount === 0) {
    return {
      name: 'No explicit any types',
      status: 'pass',
      detail: 'no `: any` or `as any` found in web/src/',
    };
  }

  return {
    name: 'No explicit any types',
    status: 'warn',
    detail: `${totalCount} \`any\` usage(s) across ${hitFiles.length} file(s): ${hitFiles
      .slice(0, 5)
      .join(', ')}${hitFiles.length > 5 ? '...' : ''}`,
    suggestions: [
      'Replace `: any` with a specific type or `unknown` where the shape is genuinely unpredictable.',
      '`as any` type assertions can often be replaced with `as unknown as TargetType` for safer narrowing.',
    ],
  };
}
