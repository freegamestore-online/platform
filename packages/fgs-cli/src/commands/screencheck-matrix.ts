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

export interface ViewportTest {
  label: string;
  width: number;
  height: number;
}

export interface ViewportTestExpanded extends ViewportTest {
  share: number;
  orientation: 'portrait' | 'landscape';
}

const REFERENCE_PORTRAIT: Array<{ width: number; height: number; label: string; share: number }> = [
  { width: 320, height: 568, label: 'iPhone SE (1st gen)', share: 99 },
  { width: 360, height: 800, label: 'Android baseline', share: 96 },
  { width: 414, height: 896, label: 'iPhone 11/Pro Max', share: 88 },
  { width: 600, height: 800, label: 'Small tablet', share: 60 },
  { width: 768, height: 1024, label: 'iPad portrait', share: 35 },
  { width: 1024, height: 1366, label: 'iPad Pro portrait', share: 20 },
];

const REFERENCE_LANDSCAPE: Array<{ width: number; height: number; label: string; share: number }> =
  [
    { width: 568, height: 320, label: 'iPhone SE landscape', share: 99 },
    { width: 667, height: 375, label: 'iPhone 8 landscape', share: 96 },
    { width: 736, height: 414, label: 'iPhone Plus landscape', share: 88 },
    { width: 800, height: 600, label: 'Small tablet landscape', share: 60 },
    { width: 1024, height: 768, label: 'iPad landscape', share: 35 },
    { width: 1366, height: 1024, label: 'iPad Pro landscape', share: 20 },
  ];

/**
 * Pick the full reference matrix to test, gated by manifest orientation.
 * For orientation='any', test both. For 'portrait'/'landscape', test only
 * that side. Sizes below `minWidth` are still tested — failing below the
 * declared min is *expected*, but if it passes, the creator can claim a
 * wider device coverage than they declared.
 */
export function pickTests(minWidth: number, orientation: string): ViewportTest[] {
  return pickMatrix(minWidth, orientation).map(({ orientation: _o, ...t }) => ({
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

/**
 * Viewports the app CLAIMS to support (width at or above the manifest's
 * `min_viewport_width`, in the declared orientation(s) — `matrix` is already
 * orientation-filtered) that failed. Any of these makes `fgs screencheck` exit
 * non-zero (#91). Failures below the declared min are expected and don't count.
 *
 * The old rule only failed when a viewport's width EXACTLY equalled the min, so
 * a min of 375/390 (no such reference width) or any landscape-only app could
 * never fail, and failures at 360/414 with the default 320 passed.
 */
export function supportedFailures(
  matrix: ViewportTestExpanded[],
  passing: Set<string>,
  minWidth: number,
): ViewportTestExpanded[] {
  return matrix.filter((t) => t.width >= minWidth && !passing.has(t.label));
}
