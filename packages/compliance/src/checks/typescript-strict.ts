import type { FileSource } from '../lib/file-source.js';
import type { CheckResult } from '../types.js';

const TSCONFIG_PATHS = ['web/tsconfig.json', 'web/tsconfig.app.json'];

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

/**
 * Every game must compile under TypeScript strict mode. Checks
 * `web/tsconfig.json` and `web/tsconfig.app.json`, follows `extends`
 * one level deep, and verifies `"strict": true` is set.
 */
export async function checkTypescriptStrict(source: FileSource): Promise<CheckResult> {
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

    // Solution-style tsconfig (only `references`, no `compilerOptions`).
    if (!compilerOptions && config.references) continue;

    if (compilerOptions?.strict === true) {
      return {
        name: 'TypeScript strict mode',
        status: 'pass',
        detail: `${path} has "strict": true`,
      };
    }

    if (hasAllStrictFlags(compilerOptions)) {
      return {
        name: 'TypeScript strict mode',
        status: 'pass',
        detail: `${path} enables all individual strict flags`,
      };
    }

    // Follow "extends" one level deep.
    const extendsPath = config.extends as string | undefined;
    if (typeof extendsPath === 'string') {
      const basePath = resolveExtends(path, extendsPath);
      const baseRaw = await source.read(basePath);
      if (baseRaw !== null) {
        const baseConfig = tryParseJson(baseRaw);
        if (baseConfig !== null) {
          const baseOpts = baseConfig.compilerOptions as Record<string, unknown> | undefined;
          if (baseOpts?.strict === true) {
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
          if (hasAllStrictFlags(baseOpts)) {
            return {
              name: 'TypeScript strict mode',
              status: 'pass',
              detail: `${path} inherits all strict flags from ${basePath}`,
            };
          }
        }
      }
    }

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

  return {
    name: 'TypeScript strict mode',
    status: 'fail',
    detail: 'no web/tsconfig.json or web/tsconfig.app.json found',
    suggestions: [
      'Create a tsconfig.json in web/ with `"strict": true` in compilerOptions.',
      'The game template includes a pre-configured tsconfig — run `fgs init` to scaffold one.',
    ],
  };
}

function hasAllStrictFlags(
  compilerOptions: Record<string, unknown> | undefined,
): boolean {
  if (!compilerOptions) return false;
  return STRICT_FLAGS.every((flag) => compilerOptions[flag] === true);
}

function resolveExtends(tsconfigPath: string, extendsValue: string): string {
  const dir = tsconfigPath.slice(0, tsconfigPath.lastIndexOf('/') + 1);
  if (extendsValue.startsWith('.')) {
    const combined = dir + extendsValue;
    return combined.endsWith('.json') ? combined : `${combined}.json`;
  }
  const candidate = `web/node_modules/${extendsValue}`;
  return candidate.endsWith('.json') ? candidate : `${candidate}/tsconfig.json`;
}

function tryParseJson(raw: string): Record<string, unknown> | null {
  try {
    const cleaned = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const parsed = JSON.parse(cleaned);
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}
