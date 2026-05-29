import type { FileSource } from '../lib/file-source.js';
import type { CheckResult } from '../types.js';

const REQUIRED = [
  {
    name: 'node_modules',
    test: (line: string) => /^node_modules\/?$/.test(line) || line === '**/node_modules',
  },
  {
    name: 'dist',
    test: (line: string) =>
      /^dist\/?$/.test(line) || /^web\/dist\/?$/.test(line) || line === '**/dist',
  },
  {
    name: '.env',
    test: (line: string) => /^\.env/.test(line),
  },
];

export async function checkGitignoreComplete(source: FileSource): Promise<CheckResult> {
  const raw = await source.read('.gitignore');
  if (raw === null) {
    return {
      name: 'Gitignore complete',
      status: 'warn',
      detail: 'no .gitignore file at repo root',
      suggestions: [
        'Add a .gitignore that covers at least: node_modules, dist, .env.',
        'Run `fgs init` to scaffold a game with a standard .gitignore.',
      ],
    };
  }

  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  const missing = REQUIRED.filter((req) => !lines.some((line) => req.test(line)));
  if (missing.length === 0) {
    return {
      name: 'Gitignore complete',
      status: 'pass',
      detail: '.gitignore covers node_modules, dist, and .env',
    };
  }
  return {
    name: 'Gitignore complete',
    status: 'warn',
    detail: `.gitignore is missing patterns for: ${missing.map((m) => m.name).join(', ')}`,
    suggestions: [
      `Add the missing patterns to .gitignore: ${missing.map((m) => m.name).join(', ')}.`,
      'These prevent build artefacts, dependencies, or secrets from being committed.',
    ],
  };
}
