import type { Browser } from 'playwright';
import { describe, expect, it } from 'vitest';
import { auditUrl, computeIndex, detectTrackers, REFERENCE } from './audit.ts';

// ---------------------------------------------------------------------------
// Unit tests for the scoring algorithm
// ---------------------------------------------------------------------------

describe('computeIndex', () => {
  const allIds = REFERENCE.map((r) => r.id);
  const portraitIds = REFERENCE.filter((r) => r.orientation === 'portrait').map((r) => r.id);
  const landscapeIds = REFERENCE.filter((r) => r.orientation === 'landscape').map((r) => r.id);

  it('returns 99 when all viewports pass', () => {
    const passing = new Set(allIds);
    expect(computeIndex(passing)).toBe(99);
  });

  it('returns 0 when no viewports pass', () => {
    const passing = new Set<string>();
    expect(computeIndex(passing)).toBe(0);
  });

  it('returns 0 when only portrait viewports pass (landscape scores 0)', () => {
    const passing = new Set(portraitIds);
    // Portrait max is 99 but landscape max is 0 -> min(99, 0) = 0
    expect(computeIndex(passing)).toBe(0);
  });

  it('returns 0 when only landscape viewports pass (portrait scores 0)', () => {
    const passing = new Set(landscapeIds);
    // Landscape max is 99 but portrait max is 0 -> min(0, 99) = 0
    expect(computeIndex(passing)).toBe(0);
  });

  it('returns min of portrait and landscape scores', () => {
    // Pass the highest portrait (p-320, share=99) and a mid landscape (l-1024, share=35)
    const passing = new Set(['p-320', 'l-1024']);
    expect(computeIndex(passing)).toBe(35);
  });

  it('takes highest share per orientation', () => {
    // Pass two portrait viewports with different shares
    const passing = new Set(['p-1024', 'p-320', 'l-568']);
    // Portrait: max(20, 99) = 99, Landscape: 99 -> min(99, 99) = 99
    expect(computeIndex(passing)).toBe(99);
  });

  it('returns 20 when only iPad Pro viewports pass (both orientations)', () => {
    const passing = new Set(['p-1024', 'l-1366']);
    // Portrait: 20, Landscape: 20 -> min(20, 20) = 20
    expect(computeIndex(passing)).toBe(20);
  });

  it('handles single viewport per orientation', () => {
    const passing = new Set(['p-414', 'l-667']);
    // Portrait: 88, Landscape: 96 -> min(88, 96) = 88
    expect(computeIndex(passing)).toBe(88);
  });
});

// ---------------------------------------------------------------------------
// #95: Chromium leak + tracker false positives
// ---------------------------------------------------------------------------

describe('auditUrl closes the browser on every path (#95)', () => {
  function fakeBrowser(gotoError: Error) {
    let closed = 0;
    const page = {
      on: () => {},
      goto: async () => {
        throw gotoError;
      },
    };
    const browser = {
      newContext: async () => ({ newPage: async () => page, close: async () => {} }),
      close: async () => {
        closed++;
      },
    };
    return { browser: browser as unknown as Browser, closed: () => closed };
  }

  it('closes the browser when the game fails to load', async () => {
    const fake = fakeBrowser(new Error('page.goto: Timeout 30000ms exceeded'));
    await expect(
      auditUrl('https://down.freegamestore.online', async () => fake.browser),
    ).rejects.toThrow(/Timeout/);
    expect(fake.closed()).toBe(1);
  });
});

describe('detectTrackers (#95)', () => {
  const none = { scriptSrcs: [], inlineScripts: [], globals: [] };

  it('does not flag ordinary game words', () => {
    expect(
      detectTrackers({
        scriptSrcs: ['https://space-rescue.freegamestore.online/assets/index-abc.js'],
        inlineScripts: [
          'const pixelSize = 4; canvas.style.imageRendering = "pixelated"; // pixel-grid',
          'segments.push(head); const heap = new MinHeap(); let amplitude = 0.3;',
          'function sentry(){ /* guard tower AI */ } const segment = 2;',
        ],
        globals: [],
      }),
    ).toEqual([]);
    expect(detectTrackers(none)).toEqual([]);
  });

  it('flags SDK scripts by host', () => {
    expect(
      detectTrackers({
        ...none,
        scriptSrcs: [
          'https://www.googletagmanager.com/gtag/js?id=G-1',
          'https://cdn.segment.com/analytics.js/v1/x/analytics.min.js',
          'https://connect.facebook.net/en_US/fbevents.js',
          'https://browser.sentry-cdn.com/7.0.0/bundle.min.js',
        ],
      }),
    ).toEqual(['facebook-pixel', 'googletagmanager', 'segment', 'sentry']);
  });

  it('flags SDK init calls in inline scripts', () => {
    expect(
      detectTrackers({
        ...none,
        inlineScripts: [
          "gtag('config', 'G-XXXX');",
          "fbq('init', '123');",
          "posthog.init('phc_x')",
        ],
      }),
    ).toEqual(['facebook-pixel', 'gtag', 'posthog']);
  });

  it('flags bundled SDKs exposed as globals', () => {
    expect(detectTrackers({ ...none, globals: ['mixpanel', 'heap'] })).toEqual([
      'heap',
      'mixpanel',
    ]);
  });

  it('ignores a script host that merely contains a tracker word', () => {
    expect(
      detectTrackers({
        ...none,
        scriptSrcs: ['https://pixel-runner.freegamestore.online/sentry.js'],
      }),
    ).toEqual([]);
  });
});
