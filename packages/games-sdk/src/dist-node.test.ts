import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Regression for #512: 0.18.0 to 0.20.0 shipped a dist whose GameTopbar.js had a bare
// `import './GameTopbar.module.css'`. Vite resolves that, but plain Node (and so vitest,
// which externalises node_modules) cannot: "Unknown file extension .css". Every game test
// that rendered an SDK component broke. This compiles the package the way `pnpm build` does
// and loads the result in a bare Node process, the way vitest would load it from node_modules.

const root = resolve(__dirname, '..');
const out = resolve(root, 'dist-node-test');

/** All .js files under `dir`, recursively. */
function jsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? jsFiles(resolve(dir, e.name))
      : e.name.endsWith('.js')
        ? [resolve(dir, e.name)]
        : [],
  );
}

describe('built dist under plain Node (#512)', () => {
  beforeAll(() => {
    rmSync(out, { recursive: true, force: true });
    execFileSync(resolve(root, 'node_modules/.bin/tsc'), ['--outDir', out], { cwd: root });
  }, 120_000);

  afterAll(() => rmSync(out, { recursive: true, force: true }));

  it('has no stylesheet imports in any dist JS file', () => {
    for (const file of jsFiles(out)) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(
        /^\s*import\s+(?:[^'"]*from\s+)?['"][^'"]+\.(?:css|scss|sass|less)['"]/m,
      );
    }
  });

  it.each(['index.js', 'feel/index.js'])('imports %s in a bare Node process', (entry) => {
    const stdout = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `const m = await import(${JSON.stringify(resolve(out, entry))}); console.log(Object.keys(m).length);`,
      ],
      { cwd: root, encoding: 'utf8' },
    );
    expect(Number(stdout.trim())).toBeGreaterThan(0);
  });
});
