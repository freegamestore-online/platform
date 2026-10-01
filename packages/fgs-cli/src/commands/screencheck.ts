import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, join, normalize, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Command } from 'commander';
import type { ViewportTest } from './screencheck-matrix.js';
import { computeCoverage, pickMatrix, supportedFailures } from './screencheck-matrix.js';
import { renderCoverage, renderResult } from './screencheck-render.js';

/**
 * Runtime viewport check: builds the app, serves the dist statically,
 * launches a headless browser at the manifest's declared
 * `min_viewport_width` in both portrait and landscape, and measures
 * whether `scrollWidth/Height` exceeds `clientWidth/Height`. Returns
 * non-zero if the app actually scrolls at the size it claims to support.
 *
 * Why a separate command (not folded into `fgs check`):
 * - Playwright + Chromium download is ~300 MB; making it a peer dep
 *   keeps the main CLI install light.
 * - A real browser run takes seconds, not the ms `fgs check` aims for.
 * - Most creators run `fgs check` constantly during dev; runtime
 *   checks are a pre-publish step.
 */

interface ScreenCheckOptions {
  dir: string;
  port: number;
  /** Skip `pnpm build` — assume dist/ is already current. */
  skipBuild: boolean;
  /** Save a PNG of every viewport to ./screencheck-out/. */
  screenshots: boolean;
  /**
   * Hit a target URL or live deployment instead of the local dist.
   * Useful for checking what visitors actually see in production.
   */
  url: string | null;
}

interface ClippingElement {
  tag: string;
  cls: string;
  id: string | null;
  scrollW: number;
  scrollH: number;
  clientW: number;
  clientH: number;
  clipsX: boolean;
  clipsY: boolean;
}

interface MeasureResult {
  label: string;
  width: number;
  height: number;
  scrollWidth: number;
  scrollHeight: number;
  scrollsX: boolean;
  scrollsY: boolean;
  /**
   * Inner-clipping elements: any element with overflow:hidden|clip
   * whose content overflows. Document scroll = false but pixels are
   * still being cut off (e.g., a sidebar / control panel half off-screen
   * inside a `100vw` flex container).
   */
  clippingElements: ClippingElement[];
}

const DEFAULT_PORT = 4571;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export const screencheckCommand = new Command('screencheck')
  .description(
    'Run a real browser at the manifest-declared viewport in portrait + landscape and verify the app fits without scrolling.',
  )
  .option('--dir <path>', 'Repo dir to check (defaults to cwd).', process.cwd())
  .option('--port <n>', `Static-server port (default ${DEFAULT_PORT}).`, String(DEFAULT_PORT))
  .option('--skip-build', 'Skip `pnpm build` — assume web/dist is current.', false)
  .option(
    '--screenshots',
    'Save a PNG per viewport to ./screencheck-out/ for visual review.',
    false,
  )
  .option('--url <url>', 'Check a live URL instead of the local build.')
  .action(
    async (raw: {
      dir: string;
      port: string;
      skipBuild?: boolean;
      screenshots?: boolean;
      url?: string;
    }) => {
      const opts: ScreenCheckOptions = {
        dir: raw.dir,
        port: Number(raw.port),
        skipBuild: Boolean(raw.skipBuild),
        screenshots: Boolean(raw.screenshots),
        url: raw.url ?? null,
      };

      if (!opts.url && !isValidPort(opts.port)) {
        process.stdout.write(
          `\n✗ --port must be a whole number from 1 to 65535 (got "${raw.port}").\n`,
        );
        process.exit(1);
      }

      const playwright = await loadPlaywright(opts.dir);
      if (!playwright) {
        process.stdout.write(
          '\n⚠  Playwright not installed.\n' +
            '   Run: pnpm add -D playwright && npx playwright install chromium\n' +
            '   Then re-run: fgs screencheck\n',
        );
        process.exit(1);
      }

      // For --url, skip the manifest read and use safe defaults.
      let minWidth: number;
      let orientation: string;
      if (opts.url) {
        minWidth = 320;
        orientation = 'any';
        process.stdout.write(`\nChecking ${opts.url} (live URL — manifest not consulted).\n`);
      } else {
        const manifest = await readManifest(opts.dir);
        if (!manifest) {
          process.stdout.write('\n✗ web/public/manifest.json not found or unparseable.\n');
          process.exit(1);
        }
        minWidth =
          typeof manifest.min_viewport_width === 'number' ? manifest.min_viewport_width : 320;
        orientation = typeof manifest.orientation === 'string' ? manifest.orientation : 'any';
        process.stdout.write(`\nManifest: orientation=${orientation} · min ${minWidth}px wide\n`);
      }

      const matrix = pickMatrix(minWidth, orientation);
      if (matrix.length === 0) {
        process.stdout.write('\n✗ Manifest orientation is invalid or no test sizes apply.\n');
        process.exit(1);
      }
      process.stdout.write(
        `Testing ${matrix.length} reference viewports across the device matrix.\n`,
      );

      const shotsDir = resolve(opts.dir, 'screencheck-out');
      let server: { close: () => void } | null = null;
      let browser: Browser | null = null;
      let exitCode = 0;
      try {
        let url: string;
        if (opts.url) {
          url = opts.url;
        } else {
          if (!opts.skipBuild) {
            process.stdout.write('\nBuilding web/dist…\n');
            await runShell('pnpm', ['build'], opts.dir);
          }
          const distDir = resolve(opts.dir, 'web', 'dist');
          if (!existsSync(distDir)) {
            throw new Error(`${distDir} doesn't exist. Run \`pnpm build\` first.`);
          }
          server = await startServer(distDir, opts.port);
          url = `http://localhost:${opts.port}/`;
          process.stdout.write(`Serving ${distDir} at ${url}\n\n`);
        }

        if (opts.screenshots) {
          const { mkdirSync } = await import('node:fs');
          mkdirSync(shotsDir, { recursive: true });
          process.stdout.write(`Saving screenshots to ${shotsDir}\n\n`);
        }

        browser = await playwright.launch();
        const results: MeasureResult[] = [];
        const passing = new Set<string>();
        for (const t of matrix) {
          const r = await measure(browser, url, t, opts.screenshots ? shotsDir : null);
          results.push(r);
          renderResult(r);
          // Pass = no document scroll AND no inner clipping.
          if (!r.scrollsX && !r.scrollsY && r.clippingElements.length === 0) {
            passing.add(t.label);
          }
        }

        const cov = computeCoverage(matrix, passing);
        const failed = results.length - passing.size;
        process.stdout.write('\n');
        renderCoverage(cov, matrix);
        process.stdout.write('\n');
        if (failed > 0) {
          process.stdout.write(
            `✗ ${failed}/${results.length} reference viewports have layout issues.\n`,
          );
          // Exit non-zero when ANY viewport the app claims to support (at or
          // above the declared min, in a declared orientation) fails (#91).
          // Failures below the declared min are expected and only informative.
          const supported = supportedFailures(matrix, passing, minWidth);
          if (supported.length > 0) {
            process.stdout.write(
              `  ${supported.length} failing viewport(s) are at or above your declared min_viewport_width (${minWidth}px): ${supported.map((t) => t.label).join(', ')}.\n`,
            );
            process.stdout.write(
              '  Either fix the layout or raise min_viewport_width in your manifest.\n',
            );
            exitCode = 1;
          } else {
            process.stdout.write(
              `  All failures are below your declared min (${minWidth}px), which is expected.\n`,
            );
          }
        } else {
          process.stdout.write(`✓ All ${results.length} reference viewports fit cleanly.\n`);
          const minPassing = Math.min(...matrix.map((t) => t.width));
          if (minPassing < minWidth) {
            process.stdout.write(
              `  You could lower min_viewport_width to ${minPassing} — your app actually fits there.\n`,
            );
          }
        }
      } catch (err) {
        // A failed build, busy port or browser crash must end the run with a
        // clear message and a non-zero exit — not an unhandled rejection that
        // leaves Chromium (and the CLI) running.
        process.stdout.write(`\n✗ ${err instanceof Error ? err.message : String(err)}\n`);
        exitCode = 1;
      } finally {
        await browser?.close().catch(() => {});
        server?.close();
      }
      process.exit(exitCode);
    },
  );

async function measure(
  browser: { newPage: (opts: unknown) => Promise<unknown> },
  url: string,
  t: ViewportTest,
  shotsDir: string | null,
): Promise<MeasureResult> {
  // Cast through unknown — we only call a tiny subset of the Page API
  // and don't want to take a Playwright type dep at module load time.
  const page = (await browser.newPage({ viewport: { width: t.width, height: t.height } })) as {
    goto: (u: string, o?: unknown) => Promise<unknown>;
    // Real Playwright accepts a function or a string expression; we use the
    // string form for browser-global code so TS doesn't type-check `document`.
    evaluate: <T>(fn: (() => T) | string) => Promise<T>;
    screenshot: (opts: { path: string; fullPage?: boolean }) => Promise<unknown>;
    close: () => Promise<void>;
  };
  await page.goto(url, { waitUntil: 'networkidle' });
  // Small settle delay — fonts, images, late-load JS.
  await page.evaluate(() => new Promise<void>((r) => setTimeout(r, 250)));
  // Bundle the document-level metrics + inner-clipping scan into one
  // page.evaluate, written as a string so TS doesn't try to type-check
  // browser globals like `document` and `getComputedStyle`. This catches
  // the common case where a layout uses `overflow:hidden` on a parent
  // to mask an oversized child — visually content is cropped, but the
  // document doesn't scroll, so a naive scrollWidth check passes.
  // Passed as a string (not a function literal) so TS doesn't type-check
  // browser globals like `document`/`getComputedStyle`. Playwright evaluates
  // the string as an expression in the page — no `new Function`/eval in Node.
  const dim = await page.evaluate<{
    scrollWidth: number;
    scrollHeight: number;
    clientWidth: number;
    clientHeight: number;
    clipping: ClippingElement[];
  }>(`
    (() => {
      const root = document.documentElement;
      const TOL = 1;
      const clipping = [];
      const elements = document.querySelectorAll('*');
      for (let i = 0; i < elements.length; i++) {
        const el = elements[i];
        const cs = getComputedStyle(el);
        const ovx = cs.overflowX;
        const ovy = cs.overflowY;
        const xClipped = (ovx === 'hidden' || ovx === 'clip') && el.scrollWidth > el.clientWidth + TOL;
        const yClipped = (ovy === 'hidden' || ovy === 'clip') && el.scrollHeight > el.clientHeight + TOL;
        if (xClipped || yClipped) {
          clipping.push({
            tag: el.tagName.toLowerCase(),
            cls: (el.className || '').toString().slice(0, 50),
            id: el.id || null,
            scrollW: el.scrollWidth,
            scrollH: el.scrollHeight,
            clientW: el.clientWidth,
            clientH: el.clientHeight,
            clipsX: xClipped,
            clipsY: yClipped,
          });
        }
      }
      return {
        scrollWidth: root.scrollWidth,
        scrollHeight: root.scrollHeight,
        clientWidth: root.clientWidth,
        clientHeight: root.clientHeight,
        clipping: clipping,
      };
    })()
  `);

  if (shotsDir) {
    const safe = t.label.replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
    await page.screenshot({ path: join(shotsDir, `${safe}.png`) });
  }
  await page.close();
  // Use a 1px tolerance — sub-pixel rounding and CSS-zoom quirks can
  // make scrollWidth = clientWidth + 1 even when nothing visibly
  // overflows.
  const TOLERANCE = 1;
  return {
    label: t.label,
    width: t.width,
    height: t.height,
    scrollWidth: dim.scrollWidth,
    scrollHeight: dim.scrollHeight,
    scrollsX: dim.scrollWidth > dim.clientWidth + TOLERANCE,
    scrollsY: dim.scrollHeight > dim.clientHeight + TOLERANCE,
    clippingElements: dim.clipping,
  };
}

async function readManifest(dir: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(join(dir, 'web', 'public', 'manifest.json'), 'utf8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

type Browser = {
  newPage: (opts: unknown) => Promise<unknown>;
  close: () => Promise<void>;
};

async function loadPlaywright(
  targetDir: string,
): Promise<{ launch: () => Promise<Browser> } | null> {
  // playwright is an OPTIONAL peer dep installed in the user's project,
  // not in the CLI's own node_modules. Resolve from the target dir so
  // the user can `pnpm add -D playwright` in their app and have it Just
  // Work, rather than needing it co-located with a globally-installed CLI.
  try {
    const require = createRequire(join(targetDir, 'package.json'));
    const resolved = require.resolve('playwright');
    const mod = (await import(pathToFileURL(resolved).href)) as {
      // playwright ships CJS, so named exports surface under `default`
      // when ESM-imported. Try both shapes for forward-compat.
      chromium?: { launch: () => Promise<Browser> };
      default?: { chromium: { launch: () => Promise<Browser> } };
    };
    return mod.chromium ?? mod.default?.chromium ?? null;
  } catch {
    return null;
  }
}

export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/** Run a command, resolving on exit 0. On Windows `pnpm` is `pnpm.cmd`, which
 *  spawn() cannot start without a shell (ENOENT, or EINVAL on patched Node), so
 *  the build step failed there (#91). */
export function runShell(
  cmd: string,
  args: string[],
  cwd: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  return new Promise((res, rej) => {
    const child = spawn(cmd, args, { cwd, stdio: 'inherit', shell: platform === 'win32' });
    child.on('exit', (code) => (code === 0 ? res() : rej(new Error(`${cmd} exited ${code}`))));
    child.on('error', rej);
  });
}

export async function startServer(rootDir: string, port: number): Promise<{ close: () => void }> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    let p = decodeURIComponent(url.pathname);
    if (p.endsWith('/')) p += 'index.html';
    const safe = normalize(p).replace(/^(\.\.[/\\])+/, '');
    const filePath = join(rootDir, safe);
    try {
      const s = await stat(filePath);
      if (s.isDirectory()) throw new Error('is dir');
      const body = await readFile(filePath);
      res.writeHead(200, {
        'Content-Type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  // Without an 'error' listener a busy port crashed the CLI with a raw stack (#91).
  await new Promise<void>((resolve, reject) => {
    server.once('error', (err: NodeJS.ErrnoException) => {
      reject(
        err.code === 'EADDRINUSE'
          ? new Error(`Port ${port} is already in use. Pass --port <n> to use a different one.`)
          : err,
      );
    });
    server.listen(port, '127.0.0.1', () => resolve());
  });
  return { close: () => server.close() };
}
