import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// #91: `fgs screencheck` only exited 1 when a failing viewport's width EXACTLY
// equalled min_viewport_width, so most real failures exited 0; it also leaked
// Chromium on errors, broke on Windows, and crashed on a busy port.

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: spawnMock,
}));

import { isValidPort, runShell, screencheckCommand, startServer } from './screencheck.js';
import { pickMatrix, supportedFailures } from './screencheck-matrix.js';

describe('supportedFailures', () => {
  const failing = (min: number, orientation: string, failWidths: number[]) => {
    const matrix = pickMatrix(min, orientation);
    const passing = new Set(
      matrix.filter((t) => !failWidths.includes(t.width)).map((t) => t.label),
    );
    return supportedFailures(matrix, passing, min).map((t) => t.width);
  };

  it('counts failures above a min that is not a reference width (375)', () => {
    expect(failing(375, 'portrait', [414])).toEqual([414]);
  });
  it('counts failures above the default min (320)', () => {
    expect(failing(320, 'portrait', [360, 414])).toEqual([360, 414]);
  });
  it('counts landscape failures for a landscape-only app', () => {
    expect(failing(320, 'landscape', [667])).toEqual([667]);
  });
  it('ignores failures below the declared min', () => {
    expect(failing(600, 'portrait', [320, 360])).toEqual([]);
  });
});

describe('robustness helpers', () => {
  it('rejects ports that are not 1..65535 integers', () => {
    expect(isValidPort(4571)).toBe(true);
    for (const bad of [Number.NaN, 0, 70000, 3.5, -1]) expect(isValidPort(bad)).toBe(false);
  });

  it('spawns through a shell on Windows (pnpm is pnpm.cmd) and not elsewhere', async () => {
    const child = () => {
      const c = new EventEmitter();
      queueMicrotask(() => c.emit('exit', 0));
      return c;
    };
    spawnMock.mockImplementation(child);
    await runShell('pnpm', ['build'], '/tmp/x', 'win32');
    expect(spawnMock.mock.calls.at(-1)?.[2]).toMatchObject({ shell: true });
    await runShell('pnpm', ['build'], '/tmp/x', 'linux');
    expect(spawnMock.mock.calls.at(-1)?.[2]).toMatchObject({ shell: false });
  });

  it('reports a busy port as a clear error instead of crashing', async () => {
    const blocker = createServer();
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', () => r()));
    const port = (blocker.address() as { port: number }).port;
    try {
      await expect(startServer(tmpdir(), port)).rejects.toThrow(`Port ${port} is already in use`);
    } finally {
      blocker.close();
    }
  });
});

describe('fgs screencheck exit code end to end', () => {
  let dir: string;
  let out: string;
  const fake = { failWidths: [] as number[], throwOnNewPage: false, closed: 0 };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'screencheck-'));
    // A stub `playwright` in the project's node_modules — the CLI resolves
    // playwright from the target project, so this is what it loads.
    const pw = join(dir, 'node_modules', 'playwright');
    mkdirSync(pw, { recursive: true });
    writeFileSync(
      join(pw, 'package.json'),
      JSON.stringify({ name: 'playwright', main: 'index.js' }),
    );
    writeFileSync(
      join(pw, 'index.js'),
      `const f = () => globalThis.__screencheckFake;
exports.chromium = { launch: async () => ({
  close: async () => { f().closed++; },
  newPage: async ({ viewport }) => {
    if (f().throwOnNewPage) throw new Error('browser crashed');
    const over = f().failWidths.includes(viewport.width) ? 50 : 0;
    return {
      goto: async () => {},
      screenshot: async () => {},
      close: async () => {},
      evaluate: async (arg) => typeof arg === 'function' ? undefined : {
        scrollWidth: viewport.width + over, clientWidth: viewport.width,
        scrollHeight: viewport.height, clientHeight: viewport.height, clipping: [],
      },
    };
  },
}) };`,
    );
    writeFileSync(join(dir, 'package.json'), '{}');
    Object.assign(fake, { failWidths: [], throwOnNewPage: false, closed: 0 });
    (globalThis as Record<string, unknown>).__screencheckFake = fake;
    out = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      out += String(chunk);
      return true;
    });
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code ?? 0}`);
    }) as never);
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function withManifest(manifest: Record<string, unknown>) {
    mkdirSync(join(dir, 'web', 'public'), { recursive: true });
    mkdirSync(join(dir, 'web', 'dist'), { recursive: true });
    writeFileSync(join(dir, 'web', 'public', 'manifest.json'), JSON.stringify(manifest));
  }
  const port = () => String(20000 + Math.floor(Math.random() * 20000));
  const run = (args: string[]) => {
    // Commander keeps parsed values on the (singleton) command between parses.
    for (const [k, v] of Object.entries({
      url: undefined,
      skipBuild: false,
      screenshots: false,
      port: '4571',
    })) {
      screencheckCommand.setOptionValue(k, v);
    }
    return screencheckCommand.parseAsync(['--dir', dir, ...args], { from: 'user' });
  };

  it('exits 1 when a supported viewport fails (default min 320, failure at 360)', async () => {
    fake.failWidths = [360];
    await expect(run(['--url', 'https://game.example'])).rejects.toThrow('exit:1');
  });

  it('exits 1 for a min that is not a reference width (375, failure at 414)', async () => {
    withManifest({ min_viewport_width: 375, orientation: 'portrait' });
    fake.failWidths = [414];
    await expect(run(['--skip-build', '--port', port()])).rejects.toThrow('exit:1');
  });

  it('exits 1 for a landscape-only app with a failing landscape viewport', async () => {
    withManifest({ min_viewport_width: 320, orientation: 'landscape' });
    fake.failWidths = [667];
    await expect(run(['--skip-build', '--port', port()])).rejects.toThrow('exit:1');
  });

  it('exits 0 when the only failures are below the declared min', async () => {
    withManifest({ min_viewport_width: 600, orientation: 'portrait' });
    fake.failWidths = [320, 360];
    await expect(run(['--skip-build', '--port', port()])).rejects.toThrow('exit:0');
  });

  it('closes the browser and exits 1 with a message when the run errors', async () => {
    fake.throwOnNewPage = true;
    await expect(run(['--url', 'https://game.example'])).rejects.toThrow('exit:1');
    expect(fake.closed).toBe(1);
    expect(out).toContain('browser crashed');
  });

  it('rejects an invalid --port up front', async () => {
    withManifest({ min_viewport_width: 320 });
    await expect(run(['--skip-build', '--port', 'abc'])).rejects.toThrow('exit:1');
    expect(out).toContain('--port must be');
  });
});
