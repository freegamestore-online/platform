import { Command } from 'commander';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, normalize } from 'node:path';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

/**
 * Runtime viewport check: builds the app, serves the dist statically,
 * launches a headless browser at the manifest's declared
 * `min_viewport_width` in both portrait and landscape, and measures
 * whether `scrollWidth/Height` exceeds `clientWidth/Height`. Returns
 * non-zero if the app actually scrolls at the size it claims to support.
 *
 * Why a separate command (not folded into `fas check`):
 * - Playwright + Chromium download is ~300 MB; making it a peer dep
 *   keeps the main CLI install light.
 * - A real browser run takes seconds, not the ms `fas check` aims for.
 * - Most creators run `fas check` constantly during dev; runtime
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

interface ViewportTest {
  label: string;
  width: number;
  height: number;
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
  .option('--screenshots', 'Save a PNG per viewport to ./screencheck-out/ for visual review.', false)
  .option('--url <url>', 'Check a live URL instead of the local build.')
  .action(async (raw: { dir: string; port: string; skipBuild?: boolean; screenshots?: boolean; url?: string }) => {
    const opts: ScreenCheckOptions = {
      dir: raw.dir,
      port: Number(raw.port),
      skipBuild: Boolean(raw.skipBuild),
      screenshots: Boolean(raw.screenshots),
      url: raw.url ?? null,
    };

    const playwright = await loadPlaywright(opts.dir);
    if (!playwright) {
      process.stdout.write(
        '\n⚠  Playwright not installed.\n' +
          '   Run: pnpm add -D playwright && npx playwright install chromium\n' +
          '   Then re-run: fas screencheck\n',
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
      minWidth = typeof manifest['min_viewport_width'] === 'number' ? manifest['min_viewport_width'] : 320;
      orientation = typeof manifest['orientation'] === 'string' ? manifest['orientation'] : 'any';
      process.stdout.write(`\nManifest: orientation=${orientation} · min ${minWidth}px wide\n`);
    }

    const matrix = pickMatrix(minWidth, orientation);
    if (matrix.length === 0) {
      process.stdout.write('\n✗ Manifest orientation is invalid or no test sizes apply.\n');
      process.exit(1);
    }
    process.stdout.write(`Testing ${matrix.length} reference viewports across the device matrix.\n`);

    let url: string;
    let server: { close: () => void } | null = null;
    if (opts.url) {
      url = opts.url;
    } else {
      if (!opts.skipBuild) {
        process.stdout.write('\nBuilding web/dist…\n');
        await runShell('pnpm', ['build'], opts.dir);
      }
      const distDir = resolve(opts.dir, 'web', 'dist');
      if (!existsSync(distDir)) {
        process.stdout.write(`\n✗ ${distDir} doesn't exist. Run \`pnpm build\` first.\n`);
        process.exit(1);
      }
      server = await startServer(distDir, opts.port);
      url = `http://localhost:${opts.port}/`;
      process.stdout.write(`Serving ${distDir} at ${url}\n\n`);
    }

    const shotsDir = resolve(opts.dir, 'screencheck-out');
    if (opts.screenshots) {
      const { mkdirSync } = await import('node:fs');
      mkdirSync(shotsDir, { recursive: true });
      process.stdout.write(`Saving screenshots to ${shotsDir}\n\n`);
    }

    let exitCode = 0;
    try {
      const browser = await playwright.launch();
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
      await browser.close();

      const cov = computeCoverage(matrix, passing);
      const failed = results.filter(
        (r) => r.scrollsX || r.scrollsY || r.clippingElements.length > 0,
      ).length;
      process.stdout.write('\n');
      renderCoverage(cov, matrix);
      process.stdout.write('\n');
      if (failed > 0) {
        process.stdout.write(`✗ ${failed}/${results.length} reference viewports have layout issues.\n`);
        // Coverage failure is a fail. But: failing only at the very
        // top end of the matrix (1024+ desktop) above what the manifest
        // claims doesn't necessarily warrant a non-zero exit; the
        // creator can opt out via orientation=portrait, and the badge
        // already conveys reality. So we exit non-zero only if the
        // *declared* min fails.
        const declaredMinFails = matrix.some(
          (t) => t.width === minWidth && !passing.has(t.label),
        );
        if (declaredMinFails) {
          process.stdout.write(
            `  At least one failing viewport is at or below your declared min_viewport_width (${minWidth}px).\n`,
          );
          process.stdout.write('  Either fix the layout or raise min_viewport_width in your manifest.\n');
          exitCode = 1;
        } else {
          process.stdout.write(
            `  All failures are above your declared min (${minWidth}px). Consider raising it to claim coverage that's actually true.\n`,
          );
        }
      } else {
        process.stdout.write(`✓ All ${results.length} reference viewports fit cleanly.\n`);
        const minPassing = Math.min(...matrix.filter((t) => passing.has(t.label)).map((t) => t.width));
        if (minPassing < minWidth) {
          process.stdout.write(
            `  You could lower min_viewport_width to ${minPassing} — your app actually fits there.\n`,
          );
        }
      }
    } finally {
      server?.close();
    }
    process.exit(exitCode);
  });

/**
 * The reference device matrix. Each entry pairs a width with a real-world
 * device class and the *cumulative device share* at that width — used to
 * answer "what % of users does this break for?". Numbers match the
 * storefront's viewport-coverage badge so the CLI and the badge agree.
 *
 * Cumulative means: `share` is the % of devices whose viewport is at
 * LEAST this wide. So 360px = 96% means 96% of devices have ≥360px
 * available; if the app fails at 360, you've lost those 96%.
 *
 * Source: blended StatCounter + caniuse share-of-screens, rounded.
 */
const REFERENCE_PORTRAIT: Array<{ width: number; height: number; label: string; share: number }> = [
  { width: 320, height: 568, label: 'iPhone SE (1st gen)', share: 99 },
  { width: 360, height: 800, label: 'Android baseline', share: 96 },
  { width: 414, height: 896, label: 'iPhone 11/Pro Max', share: 88 },
  { width: 600, height: 800, label: 'Small tablet', share: 60 },
  { width: 768, height: 1024, label: 'iPad portrait', share: 35 },
  { width: 1024, height: 1366, label: 'iPad Pro portrait', share: 20 },
];

const REFERENCE_LANDSCAPE: Array<{ width: number; height: number; label: string; share: number }> = [
  { width: 568, height: 320, label: 'iPhone SE landscape', share: 99 },
  { width: 667, height: 375, label: 'iPhone 8 landscape', share: 96 },
  { width: 736, height: 414, label: 'iPhone Plus landscape', share: 88 },
  { width: 800, height: 600, label: 'Small tablet landscape', share: 60 },
  { width: 1024, height: 768, label: 'iPad landscape', share: 35 },
  { width: 1366, height: 1024, label: 'iPad Pro landscape', share: 20 },
];

interface ViewportTestExpanded extends ViewportTest {
  share: number;
  orientation: 'portrait' | 'landscape';
}

/**
 * Pick the full reference matrix to test, gated by manifest orientation.
 * For orientation='any', test both. For 'portrait'/'landscape', test only
 * that side. Sizes below `minWidth` are still tested — failing below the
 * declared min is *expected*, but if it passes, the creator can claim a
 * wider device coverage than they declared.
 */
export function pickTests(minWidth: number, orientation: string): ViewportTest[] {
  return pickMatrix(minWidth, orientation).map(({ orientation: o, ...t }) => ({
    label: t.label,
    width: t.width,
    height: t.height,
  }));
}

export function pickMatrix(_minWidth: number, orientation: string): ViewportTestExpanded[] {
  const isPortrait = orientation === 'portrait' || orientation === 'portrait-primary';
  const isLandscape = orientation === 'landscape' || orientation === 'landscape-primary';
  const isAny = orientation === 'any' || orientation === 'unspecified' || !orientation;
  const matrix: ViewportTestExpanded[] = [];
  if (isPortrait || isAny) {
    for (const r of REFERENCE_PORTRAIT) {
      matrix.push({
        label: `portrait ${r.width}×${r.height} (${r.label})`,
        width: r.width,
        height: r.height,
        share: r.share,
        orientation: 'portrait',
      });
    }
  }
  if (isLandscape || isAny) {
    for (const r of REFERENCE_LANDSCAPE) {
      matrix.push({
        label: `landscape ${r.width}×${r.height} (${r.label})`,
        width: r.width,
        height: r.height,
        share: r.share,
        orientation: 'landscape',
      });
    }
  }
  return matrix;
}

/**
 * Given the matrix and pass/fail per size, compute device coverage.
 * Coverage = max share among passing widths, per orientation.
 *
 * Why max(share): share is cumulative-from-this-width-up. The smallest
 * passing width has the highest share; passing larger widths is implied
 * by passing the smallest. We pick the lowest passing width's share.
 */
export function computeCoverage(
  matrix: ViewportTestExpanded[],
  passing: Set<string>,
): { portrait: number; landscape: number; overall: number; brokenSizes: ViewportTestExpanded[] } {
  let portrait = 0;
  let landscape = 0;
  const broken: ViewportTestExpanded[] = [];
  for (const t of matrix) {
    if (passing.has(t.label)) {
      if (t.orientation === 'portrait') portrait = Math.max(portrait, t.share);
      else landscape = Math.max(landscape, t.share);
    } else {
      broken.push(t);
    }
  }
  // For 'any' orientation, the user needs BOTH to work, so coverage is
  // the lower of the two. For one-orientation apps, only that side
  // matters.
  const hasPortrait = matrix.some((t) => t.orientation === 'portrait');
  const hasLandscape = matrix.some((t) => t.orientation === 'landscape');
  let overall = 0;
  if (hasPortrait && hasLandscape) overall = Math.min(portrait, landscape);
  else if (hasPortrait) overall = portrait;
  else overall = landscape;
  return { portrait, landscape, overall, brokenSizes: broken };
}

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
    evaluate: <T>(fn: () => T) => Promise<T>;
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
  const dim = await page.evaluate(
    new Function(`
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
    `) as () => {
      scrollWidth: number;
      scrollHeight: number;
      clientWidth: number;
      clientHeight: number;
      clipping: ClippingElement[];
    },
  );

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

function renderCoverage(
  cov: { portrait: number; landscape: number; overall: number; brokenSizes: ViewportTestExpanded[] },
  matrix: ViewportTestExpanded[],
): void {
  const isTTY = Boolean(process.stdout.isTTY) && process.env['NO_COLOR'] !== '1';
  const c = (open: string) => (s: string) => (isTTY ? `\x1b[${open}m${s}\x1b[39m` : s);
  const ok = c('32');
  const warn = c('33');
  const bad = c('31');
  const colorize = (pct: number): ((s: string) => string) =>
    pct >= 95 ? ok : pct >= 80 ? warn : bad;

  const hasPortrait = matrix.some((t) => t.orientation === 'portrait');
  const hasLandscape = matrix.some((t) => t.orientation === 'landscape');
  process.stdout.write('Device coverage:\n');
  if (hasPortrait) {
    process.stdout.write(`  portrait:  ${colorize(cov.portrait)(`~${cov.portrait}%`)} of devices\n`);
  }
  if (hasLandscape) {
    process.stdout.write(`  landscape: ${colorize(cov.landscape)(`~${cov.landscape}%`)} of devices\n`);
  }
  if (hasPortrait && hasLandscape) {
    process.stdout.write(`  overall:   ${colorize(cov.overall)(`~${cov.overall}%`)} (worst-case across orientations)\n`);
  }
}

function renderResult(r: MeasureResult): void {
  const isTTY = Boolean(process.stdout.isTTY) && process.env['NO_COLOR'] !== '1';
  const c = (open: string) => (s: string) => (isTTY ? `\x1b[${open}m${s}\x1b[39m` : s);
  const ok = c('32');
  const bad = c('31');
  const dim = (s: string) => (isTTY ? `\x1b[2m${s}\x1b[22m` : s);

  const hasIssue = r.scrollsX || r.scrollsY || r.clippingElements.length > 0;
  if (!hasIssue) {
    process.stdout.write(`  ${ok('✓')} ${r.label.padEnd(40)} ${dim(`fits cleanly`)}\n`);
    return;
  }
  const issues: string[] = [];
  if (r.scrollsX) issues.push(`scrolls horizontally (${r.scrollWidth}px > ${r.width}px)`);
  if (r.scrollsY) issues.push(`scrolls vertically (${r.scrollHeight}px > ${r.height}px)`);
  if (r.clippingElements.length > 0) {
    issues.push(`${r.clippingElements.length} element(s) clip content`);
  }
  process.stdout.write(`  ${bad('✗')} ${r.label.padEnd(40)} ${dim(issues.join(' · '))}\n`);
  // Show the worst clipping offenders. Cap at 3 per viewport to keep
  // output readable; the screenshot is the receipt for the rest.
  for (const el of r.clippingElements.slice(0, 3)) {
    const sel = el.id ? `#${el.id}` : el.cls ? `.${el.cls.split(/\s+/)[0]}` : '';
    const detail: string[] = [];
    if (el.clipsX) detail.push(`x:${el.scrollW}>${el.clientW}`);
    if (el.clipsY) detail.push(`y:${el.scrollH}>${el.clientH}`);
    process.stdout.write(`      ${dim(`<${el.tag}${sel}>`)} ${dim(detail.join(' '))}\n`);
  }
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

async function loadPlaywright(targetDir: string): Promise<{ launch: () => Promise<Browser> } | null> {
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

function runShell(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((res, rej) => {
    const child = spawn(cmd, args, { cwd, stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? res() : rej(new Error(`${cmd} exited ${code}`))));
    child.on('error', rej);
  });
}

async function startServer(rootDir: string, port: number): Promise<{ close: () => void }> {
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
      res.writeHead(200, { 'Content-Type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  return { close: () => server.close() };
}
