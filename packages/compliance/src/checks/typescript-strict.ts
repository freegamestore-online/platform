import type { FileSource } from '../lib/file-source.js';
import type { CheckResult } from '../types.js';

const TSCONFIG_PATHS = ['web/tsconfig.json', 'web/tsconfig.app.json'];

/**
 * Every game must compile under TypeScript strict mode. This check reads
 * `web/tsconfig.json` and `web/tsconfig.app.json`, follows `extends`
 * references (one level deep), and verifies that `"strict": true` is set
 * — either directly or via the extended base config.
 *
 * The individual strict flags (`strictNullChecks`, `noImplicitAny`, etc.)
 * are also accepted as a collective substitute for `"strict": true`, but
 * only if all of them are present.
 */
export async function checkTypescriptStrict(source: FileSource): Promise<CheckResult> {
  // Try each candidate config in order. The first one that exists and
  // has strict mode wins. tsconfig.app.json typically extends
  // tsconfig.json, so check it first (it's the more specific one Vite
  // actually uses).
  for (const path of TSCONFIG_PATHS) {
    const raw = await source.read(path);
    if (raw === null) continue;

    const config = tryParseJson(raw);
    if (config === null) {
      return {
        name: 'TypeScript strict mode',
        status: 'fail',
        detail: `${path} is not valid JSON`,
        suggestions: ['Fix the JSON syntax errors in the tsconfig file.'],
      };
    }

    const compilerOptions = config.compilerOptions as Record<string, unknown> | undefined;

    // Direct "strict": true in this file.
    if (compilerOptions?.strict === true) {
      return {
        name: 'TypeScript strict mode',
        status: 'pass',
        detail: `${path} has "strict": true`,
      };
    }

    // Check if all individual strict flags are enabled.
    if (hasAllStrictFlags(compilerOptions)) {
      return {
        name: 'TypeScript strict mode',
        status: 'pass',
        detail: `${path} enables all individual strict flags`,
      };
    }

    // Follow "extends" one level deep.
    const extendsPath = config.extends;
    if (typeof extendsPath === 'string') {
      const basePath = resolveExtends(path, extendsPath);
      const baseRaw = await source.read(basePath);
      if (baseRaw !== null) {
        const baseConfig = tryParseJson(baseRaw);
        if (baseConfig !== null) {
          const baseCompilerOptions = baseConfig.compilerOptions as
            | Record<string, unknown>
            | undefined;
          if (baseCompilerOptions?.strict === true) {
            // Base has strict, but check if this config explicitly overrides it.
            if (compilerOptions?.strict === false) {
              return {
                name: 'TypeScript strict mode',
                status: 'fail',
                detail: `${path} extends ${basePath} which has "strict": true, but ${path} overrides it with "strict": false`,
                suggestions: ['Remove the `"strict": false` override from compilerOptions.'],
              };
            }
            return {
              name: 'TypeScript strict mode',
              status: 'pass',
              detail: `${path} inherits "strict": true from ${basePath}`,
            };
          }

          if (hasAllStrictFlags(baseCompilerOptions)) {
            return {
              name: 'TypeScript strict mode',
              status: 'pass',
              detail: `${path} inherits all strict flags from ${basePath}`,
            };
          }
        }
      }
    }

    // Found a tsconfig but strict is not enabled.
    return {
      name: 'TypeScript strict mode',
      status: 'fail',
      detail: `${path} does not enable strict mode`,
      suggestions: [
        'Add `"strict": true` to compilerOptions in your tsconfig.',
        'Strict mode catches null/undefined errors, implicit any types, and other common bugs at compile time.',
      ],
    };
  }

  // No tsconfig found at all.
  return {
    name: 'TypeScript strict mode',
    status: 'fail',
    detail: 'no web/tsconfig.json or web/tsconfig.app.json found',
    suggestions: [
      'Create a tsconfig.json in web/ with `"strict": true` in compilerOptions.',
      'The game template includes a pre-configured tsconfig — run `fgs create` to scaffold one.',
    ],
  };
}

/** The individual flags that `"strict": true` enables. */
const STRICT_FLAGS = [
  'strictNullChecks',
  'strictFunctionTypes',
  'strictBindCallApply',
  'strictPropertyInitialization',
  'noImplicitAny',
  'noImplicitThis',
  'alwaysStrict',
] as const;

function hasAllStrictFlags(compilerOptions: Record<string, unknown> | undefined): boolean {
  if (!compilerOptions) return false;
  return STRICT_FLAGS.every((flag) => compilerOptions[flag] === true);
}

/**
 * Resolve an `extends` path relative to the directory of the tsconfig
 * that contains it. Handles relative paths and bare package names that
 * point into node_modules.
 */
function resolveExtends(tsconfigPath: string, extendsValue: string): string {
  const dir = tsconfigPath.slice(0, tsconfigPath.lastIndexOf('/') + 1);
  if (extendsValue.startsWith('.')) {
    // Relative path — resolve against the tsconfig's directory.
    const combined = dir + extendsValue;
    // Append .json if not already present (tsc resolves it automatically).
    return combined.endsWith('.json') ? combined : `${combined}.json`;
  }
  // Bare specifier like "@tsconfig/strictest" — resolve into node_modules.
  // Try with and without .json extension.
  const candidate = `web/node_modules/${extendsValue}`;
  return candidate.endsWith('.json') ? candidate : `${candidate}/tsconfig.json`;
}

function tryParseJson(raw: string): Record<string, unknown> | null {
  try {
    // Strip JSON comments (tsconfig allows them) — simplistic removal
    // of // and /* */ style comments outside strings.
    const cleaned = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const parsed = JSON.parse(cleaned);
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}
