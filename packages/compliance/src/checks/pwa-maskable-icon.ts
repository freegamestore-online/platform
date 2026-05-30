import type { FileSource } from '../lib/file-source.js';
import { extractInlineManifest } from '../lib/inline-manifest.js';
import type { CheckResult } from '../types.js';

const STATIC_MANIFEST_PATH = 'web/public/manifest.json';
const VITE_CONFIG_PATH = 'web/vite.config.ts';

/**
 * Verifies the PWA manifest declares at least one icon with
 * `purpose: "maskable"` (or a combined value containing "maskable" such
 * as "any maskable").
 *
 * Why this matters: on Android, Chrome's installability heuristics
 * downgrade a PWA to a launcher *shortcut* (just a bookmark with the
 * site favicon) when no maskable icon is declared. With a maskable
 * icon, the same install becomes a real PWA — its own task slot, app
 * drawer entry, and adaptive icon shape.
 *
 * Detection is intentionally lenient: we look for a `purpose:` value
 * containing the substring `maskable` anywhere in the icons array.
 * That catches `'maskable'`, `'any maskable'`, `"maskable any"`, and
 * separate-entry styles alike.
 */
export async function checkMaskableIcon(source: FileSource): Promise<CheckResult> {
  const staticRaw = await source.read(STATIC_MANIFEST_PATH);
  if (staticRaw !== null) {
    return validateStatic(staticRaw);
  }

  const viteConfig = await source.read(VITE_CONFIG_PATH);
  if (viteConfig !== null && /\bVitePWA\s*\(/.test(viteConfig)) {
    return validateInline(viteConfig);
  }

  // No manifest source found at all — the `checkManifest` rule will
  // already fail loudly. Pass here so we don't double-report the same
  // root cause as two failures.
  return {
    name: 'PWA maskable icon',
    status: 'pass',
    detail: 'no manifest source (already reported by PWA manifest check)',
  };
}

function validateStatic(raw: string): CheckResult {
  let parsed: { icons?: Array<{ purpose?: unknown }> };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      name: 'PWA maskable icon',
      status: 'fail',
      detail: `${STATIC_MANIFEST_PATH} is not valid JSON`,
    };
  }
  const icons = Array.isArray(parsed.icons) ? parsed.icons : [];
  const hasMaskable = icons.some(
    (icon) => typeof icon?.purpose === 'string' && /\bmaskable\b/.test(icon.purpose),
  );
  if (hasMaskable) {
    return { name: 'PWA maskable icon', status: 'pass', detail: STATIC_MANIFEST_PATH };
  }
  return buildFail(STATIC_MANIFEST_PATH);
}

function validateInline(viteConfig: string): CheckResult {
  const inline = extractInlineManifest(viteConfig);
  if (!inline?.iconsRaw) {
    return {
      name: 'PWA maskable icon',
      status: 'fail',
      detail: `inline manifest in ${VITE_CONFIG_PATH} has no parsable icons array`,
      suggestions: ['Add an icons array to the manifest:{...} block in VitePWA({...}).'],
    };
  }
  // Lenient string-level check — see the doc-comment on `checkMaskableIcon`.
  const hasMaskable = /purpose\s*:\s*['"`][^'"`]*\bmaskable\b[^'"`]*['"`]/.test(inline.iconsRaw);
  if (hasMaskable) {
    return {
      name: 'PWA maskable icon',
      status: 'pass',
      detail: `inline manifest in ${VITE_CONFIG_PATH}`,
    };
  }
  return buildFail(`inline manifest in ${VITE_CONFIG_PATH}`);
}

function buildFail(where: string): CheckResult {
  return {
    name: 'PWA maskable icon',
    status: 'fail',
    detail: `no icon declares purpose containing "maskable" (${where})`,
    suggestions: [
      "Add `purpose: 'any maskable'` to each icon entry (or a dedicated 512×512 icon with `purpose: 'maskable'`).",
      'Without it, Android Chrome installs the app as a launcher shortcut, not a real PWA.',
    ],
  };
}
