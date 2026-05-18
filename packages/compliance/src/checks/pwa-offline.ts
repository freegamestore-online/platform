import type { FileSource } from '../lib/file-source.js';
import type { CheckResult } from '../types.js';

const VITE_CONFIG = 'web/vite.config.ts';
const INDEX_HTML = 'web/index.html';
const PUBLIC_DIR = 'web/public';

/**
 * Verifies a game's PWA can actually load from the home screen while
 * offline. Apps that ship a manifest but mis-configure the service
 * worker install fine, then show a blank screen when offline.
 *
 * Three failure modes this catches, all observed in the wild:
 *
 *  1. `maximumFileSizeToCacheInBytes` left at the workbox default (2 MB).
 *     Any bundle chunk above 2 MB is silently dropped from the precache.
 *     The SW serves index.html from cache, then the JS chunk 404s offline.
 *
 *  2. Google Fonts loaded via render-blocking <link> in index.html with
 *     no `runtimeCaching` rule. Browser HTTP cache works most of the
 *     time, but standalone-mode launches on iOS bypass it inconsistently
 *     — fonts fall back to system, and on cold first offline launch the
 *     <link> can stall paint for hundreds of ms.
 *
 *  3. Assets in extensions not covered by `globPatterns`. The default
 *     list is js/css/html/png/svg/ico/woff2. Any wasm, json, audio, etc.
 *     shipped under web/public/ isn't precached → offline 404.
 *
 * Also catches the inverse: index.html links a manifest but the config
 * has no service worker at all → "installable" PWA that always needs
 * network.
 */
export async function checkPwaOffline(source: FileSource): Promise<CheckResult> {
  const config = await source.read(VITE_CONFIG);
  const html = await source.read(INDEX_HTML);

  if (config === null) {
    return {
      name: 'PWA offline correctness',
      status: 'pass',
      detail: 'no web/vite.config.ts (not a Vite project)',
    };
  }

  const linksManifest =
    html !== null && /<link[^>]+rel\s*=\s*["']manifest["']/i.test(html);
  const linksGoogleFonts =
    html !== null && /fonts\.(googleapis|gstatic)\.com/i.test(html);

  const hasVitePwa = /\bVitePWA\s*\(/.test(config);

  // PWA-shaped (has manifest <link>) but no service worker → offline impossible.
  if (!hasVitePwa) {
    if (linksManifest) {
      return {
        name: 'PWA offline correctness',
        status: 'fail',
        detail: 'index.html links a manifest but vite.config.ts has no VitePWA → no service worker → cannot load offline from home screen',
        suggestions: [
          'Install vite-plugin-pwa and wire VitePWA({...}) in vite.config.ts.',
          'Or drop the <link rel="manifest"> from index.html if this game is not meant to be installable.',
        ],
      };
    }
    return {
      name: 'PWA offline correctness',
      status: 'pass',
      detail: 'not a PWA (no VitePWA, no manifest link)',
    };
  }

  // Extract the workbox block. Match `workbox: { ... }` allowing nested braces.
  const workbox = extractBalancedBlock(config, /workbox\s*:\s*\{/);
  if (workbox === null) {
    return {
      name: 'PWA offline correctness',
      status: 'warn',
      detail: 'VitePWA present but no workbox block parsed — defaults may leave assets unprecached',
      suggestions: [
        'Add a `workbox: { ... }` block with globPatterns, maximumFileSizeToCacheInBytes, and runtimeCaching.',
      ],
    };
  }

  const issues: string[] = [];
  const suggestions: string[] = [];

  // Issue 1: bundle-size cap. Default is 2 MiB; many real bundles exceed it.
  if (!/maximumFileSizeToCacheInBytes/.test(workbox)) {
    issues.push('no maximumFileSizeToCacheInBytes (defaults to 2 MB — bigger chunks silently skipped from precache)');
    suggestions.push('Set `maximumFileSizeToCacheInBytes: 10 * 1024 * 1024` so the main bundle is precached.');
  }

  // Issue 2: Google Fonts with no runtime caching.
  if (linksGoogleFonts) {
    const hasGoogleApisRule = /fonts\\?\.googleapis\\?\.com/.test(workbox);
    const hasGstaticRule = /fonts\\?\.gstatic\\?\.com/.test(workbox);
    if (!hasGoogleApisRule || !hasGstaticRule) {
      issues.push('index.html loads Google Fonts but workbox has no runtimeCaching for fonts.googleapis.com / fonts.gstatic.com');
      suggestions.push(
        'Add runtimeCaching CacheFirst rules for /^https:\\/\\/fonts\\.googleapis\\.com/ and /^https:\\/\\/fonts\\.gstatic\\.com/.',
      );
    }
  }

  // Issue 3: assets in public/ in extensions not covered by globPatterns.
  const globMatch = workbox.match(/globPatterns\s*:\s*\[\s*["']([^"']+)["']/);
  const pattern = globMatch?.[1];
  if (pattern && source.listDir) {
    const exts = pattern.match(/\{([^}]+)\}/);
    const extList = exts?.[1] ?? '';
    const covered = new Set(extList.split(',').map((s) => s.trim().toLowerCase()));
    const uncovered = await findUncoveredAssets(source, PUBLIC_DIR, covered);
    if (uncovered.length > 0) {
      const sample = uncovered.slice(0, 3).join(', ');
      issues.push(`web/public/ has files in extensions not in globPatterns: ${sample}${uncovered.length > 3 ? ` (+${uncovered.length - 3} more)` : ''}`);
      const newExts = [...new Set([...covered, ...uncovered.map(extOf)])].filter(Boolean).join(',');
      suggestions.push(`Extend globPatterns to cover them, e.g. \`**/*.{${newExts}}\`.`);
    }
  }

  if (issues.length === 0) {
    return {
      name: 'PWA offline correctness',
      status: 'pass',
      detail: 'workbox precaches everything, fonts cached, bundle cap raised',
    };
  }

  return {
    name: 'PWA offline correctness',
    status: 'warn',
    detail: issues.join('; '),
    suggestions,
  };
}

/**
 * Extracts the `{ ... }` body that follows the first match of `opener`,
 * walking the source character-by-character to balance braces. Ignores
 * braces inside string literals (single/double/backtick) and line and
 * block comments. Returns null if no match or unbalanced.
 *
 * Regex alone can't handle this because workbox blocks contain nested
 * objects (`options: { expiration: {...} }`) and regex doesn't balance.
 */
function extractBalancedBlock(src: string, opener: RegExp): string | null {
  const m = src.match(opener);
  if (!m || m.index === undefined) return null;
  let i = m.index + m[0].length; // start just after the `{`
  let depth = 1;
  const start = i;
  while (i < src.length) {
    const c = src[i];
    // Skip string literals
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    // Skip line comments
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    // Skip block comments
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i);
    }
    i++;
  }
  return null;
}

function extOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase();
}

/**
 * Walks web/public/ (one level deep is enough — workbox precache
 * resolves the pattern recursively, but most public assets sit at the
 * top level or one level down), returns extensions not in `covered`.
 * Ignores the manifest icons and favicons we already know are listed.
 */
async function findUncoveredAssets(
  source: FileSource,
  dir: string,
  covered: Set<string>,
): Promise<string[]> {
  if (!source.listDir) return [];
  const seen = new Set<string>();
  await walkPublic(source, dir, seen, covered, 0);
  return [...seen].sort();
}

async function walkPublic(
  source: FileSource,
  dir: string,
  seen: Set<string>,
  covered: Set<string>,
  depth: number,
): Promise<void> {
  if (depth > 3) return;
  if (!source.listDir) return;
  const entries = await source.listDir(dir);
  if (entries === null) return;
  for (const name of entries) {
    const full = `${dir}/${name}`;
    if (name.includes('.')) {
      const ext = extOf(name);
      if (!ext || covered.has(ext)) continue;
      seen.add(name);
    } else {
      // Probably a subdirectory — recurse. listDir returns null if it's actually a file.
      await walkPublic(source, full, seen, covered, depth + 1);
    }
  }
}
