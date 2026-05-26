import type { FileSource } from '../lib/file-source.js';
import type { CheckResult } from '../types.js';

const REQUIRED_ICONS = ['web/public/icon-192.png', 'web/public/icon-512.png'] as const;

/**
 * PWA installability requires a 192x192 and a 512x512 icon. The
 * platform manifest template references `icon-192.png` and
 * `icon-512.png` in `web/public/`. Both must exist for the game to be
 * installable on all devices.
 *
 * This check verifies file existence only — it doesn't validate
 * dimensions (that would require image decoding). The naming convention
 * makes the intent clear enough that a mis-sized file is caught by
 * Lighthouse at deploy time.
 */
export async function checkPwaIcons(source: FileSource): Promise<CheckResult> {
  const missing: string[] = [];

  for (const iconPath of REQUIRED_ICONS) {
    const content = await source.read(iconPath);
    if (content === null) {
      missing.push(iconPath);
    }
  }

  if (missing.length === 0) {
    return {
      name: 'PWA icons',
      status: 'pass',
      detail: 'icon-192.png and icon-512.png present in web/public/',
    };
  }

  return {
    name: 'PWA icons',
    status: 'fail',
    detail: `missing PWA icon(s): ${missing.join(', ')}`,
    suggestions: [
      'Add the missing icon file(s) to web/public/. Both icon-192.png (192x192) and icon-512.png (512x512) are required for PWA installability.',
      'Use a square PNG with your game logo on a solid background. Tools like https://realfavicongenerator.net/ can generate both sizes.',
    ],
  };
}
