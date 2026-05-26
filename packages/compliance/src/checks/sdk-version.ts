import type { FileSource } from '../lib/file-source.js';
import type { CheckResult } from '../types.js';

/**
 * Checks that `@freegamestore/games` is present in `web/package.json`
 * and meets the minimum version (^0.14.0). Older SDK versions lack
 * newer components (GameOverScreen, GameModal, etc.) and platform
 * integration hooks.
 *
 * If the dependency is entirely absent, this check passes with a
 * "checked elsewhere" note — the `uses-game-sdk` check covers that
 * case. This check only fires when the SDK IS present but outdated.
 */

const SDK_PKG = '@freegamestore/games';
const MIN_MINOR = 14; // 0.14.0

/**
 * Parse the minor version from a ^0.x.y range. Returns null if the
 * range can't be trivially parsed or the major isn't 0.
 */
function parseMinor(range: string): number | null {
  const cleaned = range.replace(/^[\^~>=<\s]+/, '');
  const match = cleaned.match(/^0\.(\d+)/);
  return match ? parseInt(match[1]!, 10) : null;
}

export async function checkSdkVersion(source: FileSource): Promise<CheckResult> {
  const raw = await source.read('web/package.json');
  if (!raw) {
    return {
      name: 'Games SDK version',
      status: 'pass',
      detail: 'web/package.json not found — deferring to uses-game-sdk check',
    };
  }

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(raw);
  } catch {
    return {
      name: 'Games SDK version',
      status: 'warn',
      detail: 'web/package.json is not valid JSON',
    };
  }

  const deps = {
    ...(typeof pkg.dependencies === 'object' && pkg.dependencies !== null ? pkg.dependencies : {}),
    ...(typeof pkg.devDependencies === 'object' && pkg.devDependencies !== null ? pkg.devDependencies : {}),
  } as Record<string, string>;

  const range = deps[SDK_PKG];
  if (!range) {
    return {
      name: 'Games SDK version',
      status: 'pass',
      detail: `${SDK_PKG} not in dependencies — deferring to uses-game-sdk check`,
    };
  }

  const minor = parseMinor(range);
  if (minor === null) {
    // Can't parse — might be `latest`, `*`, a git URL, etc. Don't block.
    return {
      name: 'Games SDK version',
      status: 'pass',
      detail: `${SDK_PKG}: ${range} (unparseable range — skipping version check)`,
    };
  }

  if (minor >= MIN_MINOR) {
    return {
      name: 'Games SDK version',
      status: 'pass',
      detail: `${SDK_PKG}: ${range}`,
    };
  }

  return {
    name: 'Games SDK version',
    status: 'warn',
    detail: `${SDK_PKG}: ${range} — minimum recommended is ^0.${MIN_MINOR}.0`,
    suggestions: [
      `Run \`npm install ${SDK_PKG}@latest\` to get the newest SDK with GameOverScreen, GameModal, and other platform components.`,
      'See the SDK changelog for what shipped since your current version.',
    ],
  };
}
