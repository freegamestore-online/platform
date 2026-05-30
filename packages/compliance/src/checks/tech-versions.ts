import type { FileSource } from '../lib/file-source.js';
import type { CheckResult } from '../types.js';

/**
 * Checks that the game's `web/package.json` dependencies match the
 * platform's recommended tech stack versions:
 *
 *   - react ^19
 *   - vite ^6
 *   - typescript ^5.7
 *   - tailwindcss (or @tailwindcss/vite) ^4
 *
 * Only checks the major version (and minor for typescript). This is a
 * WARN — older versions may work fine but miss platform optimisations,
 * SDK features, or security patches.
 */

interface VersionExpectation {
  /** npm package name(s) — first found wins. */
  packages: string[];
  /** Human label for the report. */
  label: string;
  /** Minimum major version. */
  minMajor: number;
  /** Minimum minor version (only checked when major equals minMajor). */
  minMinor?: number;
  /** Whether missing is acceptable (some games don't use Tailwind). */
  optional?: boolean;
}

const EXPECTATIONS: VersionExpectation[] = [
  { packages: ['react'], label: 'React', minMajor: 19 },
  { packages: ['vite'], label: 'Vite', minMajor: 6 },
  { packages: ['typescript'], label: 'TypeScript', minMajor: 5, minMinor: 7 },
  {
    packages: ['tailwindcss', '@tailwindcss/vite'],
    label: 'Tailwind CSS',
    minMajor: 4,
    optional: true,
  },
];

/**
 * Extract the major (and optionally minor) version from a semver range
 * string. Handles common range prefixes: ^, ~, >=, =, bare.
 * Returns null for ranges that can't be trivially parsed (e.g. `*`, `latest`).
 */
function parseMajorMinor(range: string): { major: number; minor: number } | null {
  // Strip leading range operator
  const cleaned = range.replace(/^[\^~>=<\s]+/, '');
  const match = cleaned.match(/^(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  return {
    major: parseInt(match[1]!, 10),
    minor: match[2] !== undefined ? parseInt(match[2]!, 10) : 0,
  };
}

export async function checkTechVersions(source: FileSource): Promise<CheckResult> {
  const raw = await source.read('web/package.json');
  if (!raw) {
    return {
      name: 'Tech stack versions',
      status: 'warn',
      detail: 'web/package.json not found — cannot check dependency versions',
    };
  }

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(raw);
  } catch {
    return {
      name: 'Tech stack versions',
      status: 'warn',
      detail: 'web/package.json is not valid JSON',
    };
  }

  const deps = {
    ...(typeof pkg.dependencies === 'object' && pkg.dependencies !== null ? pkg.dependencies : {}),
    ...(typeof pkg.devDependencies === 'object' && pkg.devDependencies !== null
      ? pkg.devDependencies
      : {}),
  } as Record<string, string>;

  const outdated: string[] = [];
  const missing: string[] = [];

  for (const exp of EXPECTATIONS) {
    let found = false;
    for (const pkgName of exp.packages) {
      const range = deps[pkgName];
      if (!range) continue;
      found = true;
      const ver = parseMajorMinor(range);
      if (!ver) continue; // unparseable range — skip silently

      let isOutdated = false;
      if (ver.major < exp.minMajor) {
        isOutdated = true;
      } else if (
        ver.major === exp.minMajor &&
        exp.minMinor !== undefined &&
        ver.minor < exp.minMinor
      ) {
        isOutdated = true;
      }

      if (isOutdated) {
        const minStr =
          exp.minMinor !== undefined ? `^${exp.minMajor}.${exp.minMinor}` : `^${exp.minMajor}`;
        outdated.push(`${exp.label}: ${range} (expected ${minStr}+)`);
      }
      break; // first matching package wins
    }
    if (!found && !exp.optional) {
      missing.push(exp.label);
    }
  }

  if (outdated.length === 0 && missing.length === 0) {
    return {
      name: 'Tech stack versions',
      status: 'pass',
      detail: 'all checked dependencies meet minimum platform versions',
    };
  }

  const parts: string[] = [];
  if (outdated.length > 0) parts.push(`outdated: ${outdated.join(', ')}`);
  if (missing.length > 0) parts.push(`missing: ${missing.join(', ')}`);

  return {
    name: 'Tech stack versions',
    status: 'warn',
    detail: parts.join('; '),
    suggestions: [
      'Run `npm outdated` and update to the latest majors listed above.',
      'The platform templates ship with the recommended versions — check template-game-3d or template-game-canvas for reference.',
    ],
  };
}
