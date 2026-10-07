import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Browser, chromium } from 'playwright';
import {
  REFERENCE_VIEWPORTS,
  type ReferenceViewport,
} from '../../contracts/game-metadata/v1/contract.js';

// ---------------------------------------------------------------------------
// Reference viewports — imported from shared contract
// ---------------------------------------------------------------------------

export const REFERENCE = REFERENCE_VIEWPORTS;

// ---------------------------------------------------------------------------
// Score computation — mirrors quality.js computeIndex exactly
// ---------------------------------------------------------------------------

export function computeIndex(passing: Set<string>): number {
  let portraitScore = 0;
  let landscapeScore = 0;
  let portraitSeen = false;
  let landscapeSeen = false;
  for (const r of REFERENCE) {
    const seen = passing.has(r.id);
    if (r.orientation === 'portrait') {
      portraitSeen = true;
      if (seen) portraitScore = Math.max(portraitScore, r.share);
    } else {
      landscapeSeen = true;
      if (seen) landscapeScore = Math.max(landscapeScore, r.share);
    }
  }
  if (portraitSeen && landscapeSeen) return Math.min(portraitScore, landscapeScore);
  if (portraitSeen) return portraitScore;
  return landscapeScore;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ViewportResult {
  id: string;
  label: string;
  width: number;
  height: number;
  pass: boolean;
  scrollsX: boolean;
  scrollsY: boolean;
  scrollWidth: number;
  scrollHeight: number;
  clippedInteractive: number;
  totalInteractive: number;
  smallTouchTargets: number;
  contentOverflow: number;
}

interface GameResult {
  id: string;
  name: string;
  url: string;
  score: number;
  loadTimeMs: number;
  consoleErrors: string[];
  viewports: ViewportResult[];
  usesSDK: boolean;
  hasNoSelect: boolean;
  extraNavbars: number;
  bannedLibs: string[];
  securityIssues: string[];
}

interface AuditOutput {
  timestamp: string;
  games: GameResult[];
}

// ---------------------------------------------------------------------------
// Core audit logic
// ---------------------------------------------------------------------------

interface AuditResult {
  score: number;
  loadTimeMs: number;
  consoleErrors: string[];
  viewports: ViewportResult[];
  usesSDK: boolean;
  hasNoSelect: boolean;
  extraNavbars: number;
  bannedLibs: string[];
  securityIssues: string[];
}

// ---------------------------------------------------------------------------
// Tracker detection (#95)
// ---------------------------------------------------------------------------

/** What the page exposes that can reveal a tracking SDK. Collected in the
 *  browser; judged in Node by detectTrackers so the rules are unit-testable. */
export interface TrackerSignals {
  /** Absolute src of every <script src>. */
  scriptSrcs: string[];
  /** Text of inline <script> blocks (capped). */
  inlineScripts: string[];
  /** Tracker names whose SDK global is present with its real API shape. */
  globals: string[];
}

/** SDK hosts, by tracker. A script loaded from one of these is that tracker. */
const TRACKER_HOSTS: Array<[string, RegExp]> = [
  ['google-analytics', /(^|\.)google-analytics\.com$/],
  ['googletagmanager', /(^|\.)googletagmanager\.com$/],
  ['amplitude', /(^|\.)amplitude\.com$/],
  ['mixpanel', /(^|\.)(mixpanel\.com|mxpnl\.com)$/],
  ['segment', /(^|\.)(segment\.com|segment\.io)$/],
  ['hotjar', /(^|\.)hotjar\.com$/],
  ['plausible', /(^|\.)plausible\.io$/],
  ['posthog', /(^|\.)posthog\.com$/],
  ['facebook-pixel', /(^|\.)facebook\.net$/],
  ['clarity', /(^|\.)clarity\.ms$/],
  ['sentry', /(^|\.)(sentry-cdn\.com|sentry\.io)$/],
  ['newrelic', /(^|\.)(newrelic\.com|nr-data\.net)$/],
  ['datadog', /(^|\.)(datadoghq\.com|datadoghq-browser-agent\.com)$/],
  ['logrocket', /(^|\.)(logrocket\.io|logrocket\.com|lr-ingest\.io)$/],
  ['fullstory', /(^|\.)fullstory\.com$/],
  ['heap', /(^|\.)heapanalytics\.com$/],
];

/** SDK install/init calls and loader URLs as they appear in inline scripts. */
const TRACKER_INLINE: Array<[string, RegExp]> = [
  ['google-analytics', /google-analytics\.com|googletagmanager\.com/],
  ['gtag', /\bgtag\s*\(\s*['"](?:config|event|js)['"]/],
  ['facebook-pixel', /\bfbq\s*\(\s*['"]init['"]|connect\.facebook\.net/],
  ['amplitude', /\bamplitude\s*\.\s*(?:init|getInstance)\s*\(|cdn\.amplitude\.com/],
  ['mixpanel', /\bmixpanel\s*\.\s*init\s*\(|cdn\.mxpnl\.com/],
  ['segment', /\banalytics\s*\.\s*load\s*\(|cdn\.segment\.com/],
  ['hotjar', /static\.hotjar\.com|\bhjid\s*:/],
  ['plausible', /plausible\.io/],
  ['posthog', /\bposthog\s*\.\s*init\s*\(/],
  ['clarity', /clarity\.ms/],
  ['sentry', /\bSentry\s*\.\s*init\s*\(/],
  ['newrelic', /\bNREUM\b/],
  ['datadog', /\bDD_RUM\s*\.\s*init\s*\(/],
  ['logrocket', /\bLogRocket\s*\.\s*init\s*\(/],
  ['fullstory', /edge\.fullstory\.com|\b_fs_org\b/],
  ['heap', /\bheap\s*\.\s*load\s*\(|cdn\.heapanalytics\.com/],
];

/**
 * Tracking SDKs a page actually loads (#95). The old scan did
 * `outerHTML.includes(word)` for words like `pixel`, `segment`, `heap`,
 * `sentry` and `amplitude`, so a pixel-art game (`image-rendering: pixelated`,
 * class `pixel-grid`), snake segments or a binary heap were published as
 * "Tracking/analytics" security issues. Only SDK evidence counts now: a script
 * from an SDK host, an SDK init call in an inline script, or an SDK global
 * with its real API.
 */
export function detectTrackers(signals: TrackerSignals): string[] {
  const found = new Set<string>(signals.globals);
  for (const src of signals.scriptSrcs) {
    let host = '';
    try {
      host = new URL(src).hostname;
    } catch {
      continue;
    }
    for (const [name, re] of TRACKER_HOSTS) if (re.test(host)) found.add(name);
  }
  for (const text of signals.inlineScripts) {
    for (const [name, re] of TRACKER_INLINE) if (re.test(text)) found.add(name);
  }
  return [...found].sort();
}

/**
 * Audit one game URL. The browser is closed on EVERY path (#95): it used to be
 * closed only after a fully successful audit, so each down or slow game (a
 * page.goto timeout, a crash mid-audit) leaked a Chromium process for the rest
 * of the weekly `--all` run, until memory ran out and later games failed too.
 */
export async function auditUrl(
  url: string,
  launch: () => Promise<Browser> = () => chromium.launch(),
): Promise<AuditResult> {
  const browser = await launch();
  try {
    return await auditWithBrowser(browser, url);
  } finally {
    await browser.close().catch(() => {});
  }
}

async function auditWithBrowser(browser: Browser, url: string): Promise<AuditResult> {
  const viewports: ViewportResult[] = [];
  const consoleErrors: string[] = [];
  let loadTimeMs = 0;

  for (const ref of REFERENCE) {
    const context = await browser.newContext({
      viewport: { width: ref.width, height: ref.height },
    });
    const page = await context.newPage();

    // Capture console errors
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    // Navigate and measure load time
    const start = Date.now();
    await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
    try {
      await page.waitForLoadState('networkidle', { timeout: 10_000 });
    } catch {
      // networkidle may time out for long-polling games — that's fine
    }
    const elapsed = Date.now() - start;

    // Use the first viewport's timing as the canonical load time
    if (loadTimeMs === 0) loadTimeMs = elapsed;

    // Wait for React/framework render
    await page.waitForTimeout(1500);

    // Collect unique console errors across all viewports
    for (const e of errors) {
      if (!consoleErrors.includes(e)) consoleErrors.push(e);
    }

    // Check scroll overflow
    const metrics = await page.evaluate(() => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // Check for interactive elements clipped outside the viewport
      const interactive = document.querySelectorAll(
        'button, a, input, select, textarea, [role="button"], [tabindex]',
      );
      let clippedCount = 0;
      let smallTouchTargets = 0;
      for (const el of interactive) {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const visible = style.display !== 'none' && rect.width > 0 && rect.height > 0;

        // Element is clipped if its center is outside the viewport
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        if (cx < 0 || cx > vw || cy < 0 || cy > vh) {
          clippedCount++;
        }

        // Touch target size check — only UI action buttons, not game board cells
        // Skip: platform chrome (bottom bar), game grids (many small cells are fine),
        // and elements inside the main game area that are part of the board
        const isChrome =
          el.closest('[style*="safe-area-inset"]') !== null ||
          (el instanceof HTMLAnchorElement && el.href.includes('freegamestore.online'));
        // Heuristic: if there are 10+ siblings of the same tag at the same level,
        // it's a game grid/board, not UI controls
        const parent = el.parentElement;
        const isGridCell = parent !== null && parent.querySelectorAll(el.tagName).length >= 10;
        if (visible && !isChrome && !isGridCell && (rect.width < 44 || rect.height < 44)) {
          smallTouchTargets++;
        }
      }

      // Check for elements that extend beyond the viewport
      const allElements = document.querySelectorAll('canvas, svg, div, main, section');
      let overflowCount = 0;
      for (const el of allElements) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        // Element extends significantly beyond viewport (more than 10px margin)
        if (rect.right > vw + 10 || rect.bottom > vh + 10 || rect.left < -10 || rect.top < -10) {
          // Skip small overflows and elements that are mostly visible
          const visibleArea =
            Math.max(0, Math.min(rect.right, vw) - Math.max(rect.left, 0)) *
            Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0));
          const totalArea = rect.width * rect.height;
          if (totalArea > 0 && visibleArea / totalArea < 0.9) {
            overflowCount++;
          }
        }
      }

      return {
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        innerWidth: vw,
        innerHeight: vh,
        clippedInteractive: clippedCount,
        totalInteractive: interactive.length,
        smallTouchTargets,
        contentOverflow: overflowCount,
      };
    });

    const scrollsX = metrics.scrollWidth > metrics.innerWidth;
    const scrollsY = metrics.scrollHeight > metrics.innerHeight;
    const hasClipped = metrics.clippedInteractive > 0;
    const hasSmallTargets = metrics.smallTouchTargets > 0;
    const hasContentOverflow = metrics.contentOverflow > 0;
    const pass = !scrollsX && !scrollsY && !hasClipped && !hasSmallTargets && !hasContentOverflow;

    viewports.push({
      id: ref.id,
      label: ref.label,
      width: ref.width,
      height: ref.height,
      pass,
      scrollsX,
      scrollsY,
      scrollWidth: metrics.scrollWidth,
      scrollHeight: metrics.scrollHeight,
      clippedInteractive: metrics.clippedInteractive,
      totalInteractive: metrics.totalInteractive,
      smallTouchTargets: metrics.smallTouchTargets,
      contentOverflow: metrics.contentOverflow,
    });

    await context.close();
  }

  // SDK and text-selection checks (run once on the first viewport)
  const checkContext = await browser.newContext({
    viewport: { width: REFERENCE[0].width, height: REFERENCE[0].height },
  });
  const checkPage = await checkContext.newPage();
  await checkPage.goto(url, { waitUntil: 'load', timeout: 30_000 });
  try {
    await checkPage.waitForLoadState('networkidle', { timeout: 10_000 });
  } catch {
    // ok
  }
  await checkPage.waitForTimeout(1500);

  const compliance = await checkPage.evaluate(() => {
    const hasGameShell =
      document.querySelector('[style*="position: fixed"][style*="100svh"]') !== null;
    const bodyStyle = getComputedStyle(document.body);
    const hasNoSelect = bodyStyle.userSelect === 'none' || bodyStyle.webkitUserSelect === 'none';

    // Double topbar detection — check for nav/header/appbar elements inside the game content
    // The SDK topbar is the first child of the fixed wrapper. Any additional nav/header is a violation.
    const suspectSelectors = [
      'nav',
      'header',
      '[role="banner"]',
      '[role="navigation"]',
      '[class*="navbar"]',
      '[class*="nav-bar"]',
      '[class*="top-bar"]',
      '[class*="topbar"]',
      '[class*="header"]',
      '[class*="app-bar"]',
      '[class*="appbar"]',
      '[class*="AppBar"]',
      '[class*="toolbar"]',
      '[class*="Toolbar"]',
      '[class*="MuiAppBar"]',
      '[class*="MuiToolbar"]',
    ];
    // Count nav/header elements that are NOT inside the SDK's topbar wrapper
    let extraNavbars = 0;
    for (const sel of suspectSelectors) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        const rect = el.getBoundingClientRect();
        if (rect.height === 0 || rect.width === 0) continue;
        // SDK topbar is always at top, height ~32px. Anything else is a custom bar.
        // Check if this element is NOT the SDK topbar (which is a direct child of the fixed wrapper)
        const parent = el.parentElement;
        const isSDKTopbar =
          parent?.style.cssText?.includes('flex-shrink: 0') &&
          parent?.parentElement?.style.cssText?.includes('position: fixed');
        if (!isSDKTopbar && rect.height > 20 && rect.height < 200) {
          extraNavbars++;
        }
      }
    }

    // Banned CSS libraries — check for their telltale class prefixes or stylesheets
    // Banned CSS libraries — check class names on actual DOM elements, not innerHTML text
    const bannedLibs: string[] = [];
    const allEls = document.querySelectorAll('[class]');
    const classSet = new Set<string>();
    for (const el of allEls) {
      for (const c of el.classList) classSet.add(c);
    }
    const classStr = [...classSet].join(' ');
    if (/\bMui[A-Z]/.test(classStr)) bannedLibs.push('MUI/Material UI');
    if (
      /\bbootstrap\b/i.test(classStr) ||
      classSet.has('btn-primary') ||
      classSet.has('container-fluid')
    )
      bannedLibs.push('Bootstrap');
    if (/\bchakra-/.test(classStr)) bannedLibs.push('Chakra UI');
    if (/\bant-[a-z]/.test(classStr)) bannedLibs.push('Ant Design');

    // Also check CSS frameworks via stylesheets and more class patterns
    if (/\bbtn-outline-/.test(classStr) || classSet.has('form-control'))
      bannedLibs.push('Bootstrap');
    if (/\bcss-[a-z0-9]{6,}/.test(classStr)) bannedLibs.push('Emotion/Styled (MUI dep)');
    if (classSet.has('v-application') || /\bvuetify\b/i.test(classStr)) bannedLibs.push('Vuetify');

    const links = document.querySelectorAll('link[rel="stylesheet"]');
    for (const link of links) {
      const href = (link as HTMLLinkElement).href.toLowerCase();
      if (href.includes('bootstrap')) bannedLibs.push('Bootstrap');
      if (href.includes('@mui') || href.includes('material-ui')) bannedLibs.push('MUI');
      if (href.includes('chakra')) bannedLibs.push('Chakra UI');
      if (href.includes('antd') || href.includes('ant-design')) bannedLibs.push('Ant Design');
      if (href.includes('bulma')) bannedLibs.push('Bulma');
      if (href.includes('semantic')) bannedLibs.push('Semantic UI');
      if (href.includes('foundation')) bannedLibs.push('Foundation');
    }

    // --- Security & malicious content scan ---
    const securityIssues: string[] = [];
    const html = document.documentElement.outerHTML;
    const scripts = document.querySelectorAll('script');

    // 1. Third-party scripts (only Google Fonts CDN allowed)
    for (const s of scripts) {
      const src = s.src;
      if (!src) continue;
      const u = new URL(src, location.href);
      if (u.origin === location.origin) continue; // same-origin OK
      if (u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com') continue;
      if (u.hostname === 'static.cloudflareinsights.com') continue; // CF Pages analytics (injected by platform)
      securityIssues.push(`Third-party script: ${u.hostname}`);
    }

    // 2. Tracking / analytics SDKs: collect evidence here, judge in Node
    // (detectTrackers) — never by searching the page text for words (#95).
    // biome-ignore lint/suspicious/noExplicitAny: Need dynamic property access on window object
    const w = window as unknown as Record<string, any>;
    const isFn = (v: unknown) => typeof v === 'function';
    const sdkGlobals: Array<[string, boolean]> = [
      ['gtag', isFn(w.gtag)],
      ['facebook-pixel', isFn(w.fbq)],
      ['amplitude', isFn(w.amplitude?.init) || isFn(w.amplitude?.getInstance)],
      ['mixpanel', isFn(w.mixpanel?.track) && isFn(w.mixpanel?.init)],
      [
        'segment',
        isFn(w.analytics?.track) && isFn(w.analytics?.identify) && isFn(w.analytics?.page),
      ],
      ['hotjar', isFn(w.hj) && w._hjSettings !== undefined],
      ['plausible', isFn(w.plausible)],
      ['posthog', isFn(w.posthog?.capture) && isFn(w.posthog?.init)],
      ['clarity', isFn(w.clarity)],
      ['sentry', isFn(w.Sentry?.captureException)],
      ['newrelic', isFn(w.newrelic?.addPageAction)],
      ['datadog', isFn(w.DD_RUM?.init)],
      ['logrocket', isFn(w.LogRocket?.init)],
      ['fullstory', isFn(w.FS) && typeof w._fs_namespace === 'string'],
      ['heap', isFn(w.heap?.track) && isFn(w.heap?.load)],
    ];
    const trackerSignals = {
      scriptSrcs: [...scripts].map((sc) => sc.src).filter(Boolean),
      inlineScripts: [...scripts]
        .filter((sc) => !sc.src)
        .map((sc) => (sc.textContent ?? '').slice(0, 20_000)),
      globals: sdkGlobals.filter(([, present]) => present).map(([name]) => name),
    };

    // 3. Inline event handlers (XSS vector)
    const inlineHandlers = document.querySelectorAll(
      '[onload], [onerror], [onmouseover], [onfocus], [onblur], [onsubmit]',
    );
    if (inlineHandlers.length > 0) {
      securityIssues.push(`${inlineHandlers.length} inline event handlers (XSS risk)`);
    }

    // 4. Iframes to external domains
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      const src = iframe.src;
      if (src && !src.startsWith(location.origin) && !src.startsWith('about:')) {
        securityIssues.push(`External iframe: ${new URL(src).hostname}`);
      }
    }

    // 5. Forms with external action
    const forms = document.querySelectorAll('form[action]');
    for (const form of forms) {
      const action = (form as HTMLFormElement).action;
      if (action && !action.startsWith(location.origin)) {
        securityIssues.push(`External form action: ${action}`);
      }
    }

    // 6. Crypto mining signatures
    const miners = ['coinhive', 'cryptoloot', 'coin-hive', 'webminer', 'minero', 'jsecoin'];
    for (const m of miners) {
      if (html.toLowerCase().includes(m)) securityIssues.push(`Crypto miner: ${m}`);
    }

    // 7. Data exfiltration patterns
    const exfil = ['navigator.sendBeacon', 'XMLHttpRequest', 'fetch('].filter((p) => {
      // Only flag if pointing to external domains in inline scripts
      for (const s of scripts) {
        if (!s.src && s.textContent?.includes(p)) {
          // Check if it's calling an external URL
          const match = s.textContent.match(new RegExp(`${p}\\s*\\(\\s*['"\`]https?://([^/]+)`));
          if (
            match &&
            !match[1].includes('freegamestore.online') &&
            !match[1].includes('localhost')
          ) {
            return true;
          }
        }
      }
      return false;
    });
    if (exfil.length > 0) securityIssues.push(`Data exfiltration: ${exfil.join(', ')}`);

    // 8. localStorage/cookie abuse — check for excessive storage
    let storageKeys = 0;
    try {
      storageKeys = localStorage.length;
    } catch {}
    if (storageKeys > 20) securityIssues.push(`Excessive localStorage: ${storageKeys} keys`);

    // 9. Eval usage (code injection risk)
    // Can't detect eval in built code easily, but check for obvious patterns
    for (const s of scripts) {
      if (!s.src && s.textContent) {
        if (/\beval\s*\(/.test(s.textContent) || /new\s+Function\s*\(/.test(s.textContent)) {
          securityIssues.push('eval() or new Function() detected');
          break;
        }
      }
    }

    // 10. External image beacons (tracking pixels)
    const imgs = document.querySelectorAll('img');
    for (const img of imgs) {
      const src = img.src;
      if (!src) continue;
      try {
        const u = new URL(src);
        if (
          u.origin !== location.origin &&
          !u.hostname.includes('googleapis.com') &&
          (img.width <= 2 || img.height <= 2 || img.naturalWidth <= 2)
        ) {
          securityIssues.push(`Tracking pixel: ${u.hostname}`);
        }
      } catch {}
    }

    return {
      hasGameShell,
      hasNoSelect,
      extraNavbars,
      bannedLibs: [...new Set(bannedLibs)],
      securityIssues: [...new Set(securityIssues)],
      trackerSignals,
    };
  });
  await checkContext.close();

  const usesSDK = compliance.hasGameShell;
  const hasNoSelect = compliance.hasNoSelect;
  const extraNavbars = compliance.extraNavbars;
  const bannedLibs = compliance.bannedLibs;
  const securityIssues = [
    ...new Set([
      ...compliance.securityIssues,
      ...detectTrackers(compliance.trackerSignals).map((t) => `Tracking/analytics: ${t}`),
    ]),
  ];

  // Compute score
  const passing = new Set<string>();
  for (const vp of viewports) {
    if (vp.pass) passing.add(vp.id);
  }
  const score = computeIndex(passing);

  return {
    score,
    loadTimeMs,
    consoleErrors,
    viewports,
    usesSDK,
    hasNoSelect,
    extraNavbars,
    bannedLibs,
    securityIssues,
  };
}

// ---------------------------------------------------------------------------
// Terminal output helpers
// ---------------------------------------------------------------------------

function printResults(url: string, result: Awaited<ReturnType<typeof auditUrl>>): void {
  console.log(`\nAuditing ${url} ...\n`);

  const idWidth = 8;
  const labelWidth = 24;

  for (const vp of result.viewports) {
    const id = vp.id.padEnd(idWidth);
    const label = vp.label.padEnd(labelWidth);
    if (vp.pass) {
      console.log(`  ${id} ${label} \x1b[32m\u2713 fits\x1b[0m`);
    } else {
      const reasons: string[] = [];
      if (vp.scrollsX) reasons.push(`scrolls horizontally (${vp.scrollWidth}px > ${vp.width}px)`);
      if (vp.scrollsY) reasons.push(`scrolls vertically (${vp.scrollHeight}px > ${vp.height}px)`);
      if (vp.clippedInteractive > 0)
        reasons.push(
          `${vp.clippedInteractive}/${vp.totalInteractive} interactive elements clipped off-screen`,
        );
      if (vp.smallTouchTargets > 0)
        reasons.push(`${vp.smallTouchTargets} touch targets smaller than 44px`);
      if (vp.contentOverflow > 0)
        reasons.push(`${vp.contentOverflow} elements render outside viewport`);
      console.log(`  ${id} ${label} \x1b[31m\u2717 ${reasons.join(', ')}\x1b[0m`);
    }
  }

  const maxScore = Math.max(...REFERENCE.map((r: ReferenceViewport) => r.share));
  console.log(`\nScore: ${result.score}/${maxScore}`);
  console.log(`Console errors: ${result.consoleErrors.length}`);
  if (result.consoleErrors.length > 0) {
    for (const e of result.consoleErrors) {
      console.log(`  - ${e}`);
    }
  }
  console.log(`Load time: ${result.loadTimeMs}ms`);

  // SDK compliance
  if (result.usesSDK) {
    console.log(`SDK: \x1b[32m\u2713 GameShell detected\x1b[0m`);
  } else {
    console.log(`SDK: \x1b[31m\u2717 GameShell not detected\x1b[0m`);
  }

  // Text selection compliance
  if (result.hasNoSelect) {
    console.log(`Text selection: \x1b[32m\u2713 disabled\x1b[0m`);
  } else {
    console.log(`Text selection: \x1b[31m\u2717 not disabled\x1b[0m`);
  }

  // Touch target summary
  const failingVps = result.viewports.filter((vp) => vp.smallTouchTargets > 0);
  if (failingVps.length === 0) {
    console.log(`Touch targets: \x1b[32m\u2713 all \u226544px\x1b[0m`);
  } else {
    const totalSmall = failingVps.reduce((sum, vp) => sum + vp.smallTouchTargets, 0);
    const vpIds = failingVps.map((vp) => vp.id).join(', ');
    console.log(
      `Touch targets: \x1b[31m\u2717 ${totalSmall} elements below 44px at ${vpIds}\x1b[0m`,
    );
  }

  // Content overflow summary
  const overflowVps = result.viewports.filter((vp) => vp.contentOverflow > 0);
  if (overflowVps.length === 0) {
    console.log(`Content overflow: \x1b[32m\u2713 all content within viewport\x1b[0m`);
  } else {
    const totalOverflow = overflowVps.reduce((sum, vp) => sum + vp.contentOverflow, 0);
    const vpIds = overflowVps.map((vp) => vp.id).join(', ');
    console.log(
      `Content overflow: \x1b[31m\u2717 ${totalOverflow} elements render outside viewport at ${vpIds}\x1b[0m`,
    );
  }

  // Security check
  if (result.securityIssues.length === 0) {
    console.log(`Security: \x1b[32m\u2713 no issues detected\x1b[0m`);
  } else {
    console.log(`Security: \x1b[31m\u2717 ${result.securityIssues.length} issues found:\x1b[0m`);
    for (const issue of result.securityIssues) {
      console.log(`  \x1b[31m- ${issue}\x1b[0m`);
    }
  }

  // Double topbar check
  if (result.extraNavbars === 0) {
    console.log(`Double topbar: \x1b[32m\u2713 no extra nav/header detected\x1b[0m`);
  } else {
    console.log(
      `Double topbar: \x1b[31m\u2717 ${result.extraNavbars} extra nav/header elements found — use SDK topbar only\x1b[0m`,
    );
  }

  // Banned CSS libraries check
  if (result.bannedLibs.length === 0) {
    console.log(`CSS libraries: \x1b[32m\u2713 none detected (Tailwind only)\x1b[0m`);
  } else {
    console.log(
      `CSS libraries: \x1b[31m\u2717 banned: ${result.bannedLibs.join(', ')} — use Tailwind CSS only\x1b[0m`,
    );
  }

  console.log('');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const allMode = args.includes('--all');
  const outputIdx = args.indexOf('--output');
  const outputPath = outputIdx !== -1 ? args[outputIdx + 1] : undefined;

  if (allMode) {
    // Platform mode — read registry and test all games.
    // import.meta.dirname (not __dirname — this runs as ESM under tsx, where
    // __dirname doesn't exist; it crashed every weekly run since the cron
    // shipped). The store repo is checked out INSIDE the workspace in CI
    // (./freegamestore) but as a SIBLING locally (../freegamestore) — try both.
    const here = import.meta.dirname;
    const registryPath = [
      resolve(here, 'freegamestore/registry.json'),
      resolve(here, '../freegamestore/registry.json'),
    ].find(existsSync);
    if (!registryPath) {
      console.error('registry.json not found (looked in ./freegamestore and ../freegamestore)');
      process.exit(1);
    }
    const registry = JSON.parse(readFileSync(registryPath, 'utf-8'));
    const games: { id: string; name: string; appUrl: string }[] = registry.games || [];

    if (games.length === 0) {
      console.log('No games found in registry.');
      process.exit(1);
    }

    console.log(`\nAuditing ${games.length} games from registry...\n`);

    const results: GameResult[] = [];

    for (const game of games) {
      console.log(`--- ${game.name || game.id} (${game.appUrl}) ---`);
      try {
        const result = await auditUrl(game.appUrl);
        printResults(game.appUrl, result);
        results.push({
          id: game.id,
          name: game.name || game.id,
          url: game.appUrl,
          score: result.score,
          loadTimeMs: result.loadTimeMs,
          consoleErrors: result.consoleErrors,
          viewports: result.viewports,
          usesSDK: result.usesSDK,
          hasNoSelect: result.hasNoSelect,
          extraNavbars: result.extraNavbars,
          bannedLibs: result.bannedLibs,
          securityIssues: result.securityIssues,
        });
      } catch (err) {
        console.error(`  Failed to audit ${game.id}: ${err}`);
        results.push({
          id: game.id,
          name: game.name || game.id,
          url: game.appUrl,
          score: 0,
          loadTimeMs: 0,
          consoleErrors: [`Audit failed: ${err}`],
          viewports: [],
          usesSDK: false,
          hasNoSelect: false,
          extraNavbars: 0,
          bannedLibs: [],
          securityIssues: [],
        });
      }
    }

    const output: AuditOutput = {
      timestamp: new Date().toISOString(),
      games: results,
    };

    const outFile = outputPath || 'quality-results.json';
    writeFileSync(outFile, JSON.stringify(output, null, 2));
    console.log(`\nResults written to ${outFile}`);
  } else {
    // Dev mode — single URL
    const url = args.find((a) => !a.startsWith('--'));
    if (!url) {
      console.error('Usage:');
      console.error('  npx tsx audit.ts <url>                          # dev mode');
      console.error('  npx tsx audit.ts --all --output results.json    # platform mode');
      process.exit(1);
    }

    const result = await auditUrl(url);
    printResults(url, result);

    // Exit with non-zero if score is below max
    const maxScore = Math.max(...REFERENCE.map((r: ReferenceViewport) => r.share));
    if (result.score < maxScore) {
      process.exit(1);
    }
  }
}

// Only run main when executed directly (not imported by tests)
const isDirectRun = process.argv[1]?.endsWith('audit.ts');
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
