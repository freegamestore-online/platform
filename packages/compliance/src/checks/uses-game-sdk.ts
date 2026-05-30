import type { FileSource } from '../lib/file-source.js';
import { stripCommentsForExt } from '../lib/strip.js';
import type { CheckResult } from '../types.js';

const PACKAGE_JSON = 'web/package.json';
const SDK_PACKAGE = '@freegamestore/games';

const SCAN_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx']);

/**
 * Every game on freegamestore.online must use the platform SDK's
 * `GameShell` wrapper from `@freegamestore/games`. GameShell provides
 * the standard chrome (back button, fullscreen, mute), lifecycle hooks,
 * and platform integration (analytics, KV, rooms) that the storefront
 * relies on.
 *
 * Two things are checked:
 *   1. `@freegamestore/games` appears in `web/package.json` dependencies.
 *   2. At least one source file in `web/src/` imports `GameShell` from
 *      the SDK.
 */
export async function checkUsesGameSdk(source: FileSource): Promise<CheckResult> {
  // Check 1: SDK in package.json dependencies.
  const pkgRaw = await source.read(PACKAGE_JSON);
  let hasDependency = false;
  if (pkgRaw !== null) {
    try {
      const pkg = JSON.parse(pkgRaw);
      hasDependency =
        (typeof pkg.dependencies === 'object' && SDK_PACKAGE in pkg.dependencies) ||
        (typeof pkg.devDependencies === 'object' && SDK_PACKAGE in pkg.devDependencies);
    } catch {
      // Invalid JSON — will fail the dependency check below.
    }
  }

  // Check 2: GameShell import in source files under web/src/.
  let hasGameShellImport = false;
  for await (const path of source.list()) {
    if (!path.startsWith('web/src/')) continue;
    const ext = extOf(path);
    if (!SCAN_EXTS.has(ext)) continue;
    const raw = await source.read(path);
    if (!raw) continue;
    const content = stripCommentsForExt(raw, ext);
    // Match: import { GameShell } from '@freegamestore/games'
    //        import { GameShell, ... } from '@freegamestore/games'
    //        import { ..., GameShell } from '@freegamestore/games'
    if (
      /import\s+\{[^}]*\bGameShell\b[^}]*\}\s+from\s+['"]@freegamestore\/games['"]/i.test(content)
    ) {
      hasGameShellImport = true;
      break;
    }
  }

  if (hasDependency && hasGameShellImport) {
    return {
      name: 'Uses GameShell SDK',
      status: 'pass',
      detail: '@freegamestore/games dependency present and GameShell imported',
    };
  }

  const issues: string[] = [];
  const suggestions: string[] = [];

  if (!hasDependency) {
    issues.push(`${SDK_PACKAGE} not in web/package.json dependencies`);
    suggestions.push(`Run \`cd web && npm install ${SDK_PACKAGE}\` to add the platform SDK.`);
  }

  if (!hasGameShellImport) {
    issues.push('no GameShell import found in web/src/');
    suggestions.push(
      "Import and use GameShell in your entry point: `import { GameShell } from '@freegamestore/games';`",
    );
    suggestions.push(
      'GameShell provides the standard game chrome (back, fullscreen, mute), lifecycle hooks, and platform integration.',
    );
  }

  return {
    name: 'Uses GameShell SDK',
    status: 'fail',
    detail: issues.join('; '),
    suggestions,
  };
}

function extOf(path: string): string {
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  return dot > slash ? path.slice(dot).toLowerCase() : '';
}
