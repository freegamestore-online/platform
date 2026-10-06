/**
 * Shared game metadata contract: unified game categories and reference viewports
 * for compliance testing and storefront categorization.
 *
 * This consolidates duplicated category and viewport lists across:
 * - apps/console (CreateGameForm.tsx, GameSettings.tsx)
 * - packages/fgs-cli (publish.ts, screencheck-matrix.ts)
 * - jobs/auditor (audit.ts)
 * - apps/admin (publish.ts)
 */

/** Game category with slug and display label. */
export interface GameCategory {
  slug: string;
  label: string;
}

/** Reference viewport for compliance testing. */
export interface ReferenceViewport {
  id: string;
  label: string;
  width: number;
  height: number;
  orientation: 'portrait' | 'landscape';
  share: number;
}

/**
 * Canonical game categories. The slug is what's stored in the registry and
 * sent to the API; the label is displayed in the UI.
 */
export const GAME_CATEGORIES: GameCategory[] = [
  { slug: 'strategy', label: 'Strategy' },
  { slug: 'brain-training', label: 'Brain Training' },
  { slug: 'arcade', label: 'Arcade' },
  { slug: 'racing', label: 'Racing' },
  { slug: 'sports', label: 'Sports' },
  { slug: 'cards', label: 'Cards' },
  { slug: 'casual', label: 'Casual' },
  { slug: 'puzzle', label: 'Puzzle' },
  { slug: 'board', label: 'Board' },
  { slug: 'rpg', label: 'RPG' },
  { slug: 'action', label: 'Action' },
  { slug: 'other', label: 'Other (specify in description)' },
];

/**
 * Reference viewports for compliance testing. These match the device matrix
 * used for viewport coverage on the storefront. The `share` field represents
 * the cumulative percentage of devices with at least this viewport width.
 *
 * Source: blended StatCounter + caniuse share-of-screens, rounded.
 */
export const REFERENCE_VIEWPORTS: ReferenceViewport[] = [
  // Portrait
  {
    id: 'p-320',
    label: '320x568 iPhone SE',
    width: 320,
    height: 568,
    orientation: 'portrait',
    share: 99,
  },
  {
    id: 'p-360',
    label: '360x800 Android',
    width: 360,
    height: 800,
    orientation: 'portrait',
    share: 96,
  },
  {
    id: 'p-393',
    label: '393x852 iPhone 15',
    width: 393,
    height: 852,
    orientation: 'portrait',
    share: 92,
  },
  {
    id: 'p-414',
    label: '414x896 iPhone 11 PM',
    width: 414,
    height: 896,
    orientation: 'portrait',
    share: 88,
  },
  {
    id: 'p-600',
    label: '600x800 Tablet',
    width: 600,
    height: 800,
    orientation: 'portrait',
    share: 60,
  },
  {
    id: 'p-768',
    label: '768x1024 iPad',
    width: 768,
    height: 1024,
    orientation: 'portrait',
    share: 35,
  },
  {
    id: 'p-1024',
    label: '1024x1366 iPad Pro',
    width: 1024,
    height: 1366,
    orientation: 'portrait',
    share: 20,
  },
  // Landscape
  {
    id: 'l-568',
    label: '568x320 iPhone SE land.',
    width: 568,
    height: 320,
    orientation: 'landscape',
    share: 99,
  },
  {
    id: 'l-667',
    label: '667x375 iPhone 8 land.',
    width: 667,
    height: 375,
    orientation: 'landscape',
    share: 96,
  },
  {
    id: 'l-736',
    label: '736x414 iPhone+ land.',
    width: 736,
    height: 414,
    orientation: 'landscape',
    share: 88,
  },
  {
    id: 'l-1024',
    label: '1024x768 iPad land.',
    width: 1024,
    height: 768,
    orientation: 'landscape',
    share: 35,
  },
  {
    id: 'l-1366',
    label: '1366x1024 iPad Pro land.',
    width: 1366,
    height: 1024,
    orientation: 'landscape',
    share: 20,
  },
];

/**
 * Look up a category by slug.
 */
export function getCategoryBySlug(slug: string): GameCategory | undefined {
  return GAME_CATEGORIES.find((c) => c.slug === slug);
}

/**
 * Look up a category by label (case-insensitive).
 */
export function getCategoryByLabel(label: string): GameCategory | undefined {
  const normalized = label.toLowerCase().trim();
  return GAME_CATEGORIES.find((c) => c.label.toLowerCase() === normalized);
}

/**
 * Normalize a category input (slug or label) to its canonical slug.
 * Returns the slug if found, otherwise returns the input as-is (likely invalid).
 */
export function normalizeCategorySlug(input: string): string {
  const trimmed = input.trim();
  // Try as a slug first
  if (GAME_CATEGORIES.find((c) => c.slug === trimmed)) {
    return trimmed;
  }
  // Try as a label
  const byLabel = getCategoryByLabel(trimmed);
  if (byLabel) {
    return byLabel.slug;
  }
  // Not found; return as-is
  return trimmed;
}

/**
 * Get all category slugs (for validation).
 */
export function getCategorySlugs(): string[] {
  return GAME_CATEGORIES.map((c) => c.slug);
}

/**
 * Check if a slug is valid.
 */
export function isValidCategorySlug(slug: string): boolean {
  return GAME_CATEGORIES.some((c) => c.slug === slug);
}
