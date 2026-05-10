import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

// ---------------------------------------------------------------------------
// Reference viewports — mirrors quality.js REFERENCE exactly
// ---------------------------------------------------------------------------

export const REFERENCE = [
  { id: "p-320",  label: "320x568 iPhone SE",       width: 320,  height: 568,  orientation: "portrait"  as const, share: 99 },
  { id: "p-360",  label: "360x800 Android",          width: 360,  height: 800,  orientation: "portrait"  as const, share: 96 },
  { id: "p-393",  label: "393x852 iPhone 15",        width: 393,  height: 852,  orientation: "portrait"  as const, share: 92 },
  { id: "p-414",  label: "414x896 iPhone 11 PM",     width: 414,  height: 896,  orientation: "portrait"  as const, share: 88 },
  { id: "p-600",  label: "600x800 Tablet",           width: 600,  height: 800,  orientation: "portrait"  as const, share: 60 },
  { id: "p-768",  label: "768x1024 iPad",            width: 768,  height: 1024, orientation: "portrait"  as const, share: 35 },
  { id: "p-1024", label: "1024x1366 iPad Pro",       width: 1024, height: 1366, orientation: "portrait"  as const, share: 20 },
  { id: "l-568",  label: "568x320 iPhone SE land.",  width: 568,  height: 320,  orientation: "landscape" as const, share: 99 },
  { id: "l-667",  label: "667x375 iPhone 8 land.",   width: 667,  height: 375,  orientation: "landscape" as const, share: 96 },
  { id: "l-736",  label: "736x414 iPhone+ land.",    width: 736,  height: 414,  orientation: "landscape" as const, share: 88 },
  { id: "l-1024", label: "1024x768 iPad land.",      width: 1024, height: 768,  orientation: "landscape" as const, share: 35 },
  { id: "l-1366", label: "1366x1024 iPad Pro land.", width: 1366, height: 1024, orientation: "landscape" as const, share: 20 },
];

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
    if (r.orientation === "portrait") {
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

async function auditUrl(url: string): Promise<AuditResult> {
  const browser = await chromium.launch();
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
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(msg.text());
      }
    });

    // Navigate and measure load time
    const start = Date.now();
    await page.goto(url, { waitUntil: "load", timeout: 30_000 });
    try {
      await page.waitForLoadState("networkidle", { timeout: 10_000 });
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
      const interactive = document.querySelectorAll('button, a, input, select, textarea, [role="button"], [tabindex]');
      let clippedCount = 0;
      let smallTouchTargets = 0;
      for (const el of interactive) {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const visible = style.display !== "none" && rect.width > 0 && rect.height > 0;

        // Element is clipped if its center is outside the viewport
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        if (cx < 0 || cx > vw || cy < 0 || cy > vh) {
          clippedCount++;
        }

        // Touch target size check — only UI action buttons, not game board cells
        // Skip: platform chrome (bottom bar), game grids (many small cells are fine),
        // and elements inside the main game area that are part of the board
        const isChrome = el.closest('[style*="safe-area-inset"]') !== null
          || (el instanceof HTMLAnchorElement && el.href.includes('freegamestore.online'));
        // Heuristic: if there are 10+ siblings of the same tag at the same level,
        // it's a game grid/board, not UI controls
        const parent = el.parentElement;
        const isGridCell = parent !== null
          && parent.querySelectorAll(el.tagName).length >= 10;
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
          const visibleArea = Math.max(0, Math.min(rect.right, vw) - Math.max(rect.left, 0)) *
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
  await checkPage.goto(url, { waitUntil: "load", timeout: 30_000 });
  try {
    await checkPage.waitForLoadState("networkidle", { timeout: 10_000 });
  } catch {
    // ok
  }
  await checkPage.waitForTimeout(1500);

  const compliance = await checkPage.evaluate(() => {
    const hasGameShell = document.querySelector('[style*="position: fixed"][style*="100svh"]') !== null;
    const bodyStyle = getComputedStyle(document.body);
    const hasNoSelect = bodyStyle.userSelect === "none" || bodyStyle.webkitUserSelect === "none";

    // Double topbar detection — check for nav/header/appbar elements inside the game content
    // The SDK topbar is the first child of the fixed wrapper. Any additional nav/header is a violation.
    const suspectSelectors = [
      'nav', 'header', '[role="banner"]', '[role="navigation"]',
      '[class*="navbar"]', '[class*="nav-bar"]', '[class*="top-bar"]', '[class*="topbar"]',
      '[class*="header"]', '[class*="app-bar"]', '[class*="appbar"]', '[class*="AppBar"]',
      '[class*="toolbar"]', '[class*="Toolbar"]',
      '[class*="MuiAppBar"]', '[class*="MuiToolbar"]',
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
        const isSDKTopbar = parent?.style.cssText?.includes('flex-shrink: 0') &&
          parent?.parentElement?.style.cssText?.includes('position: fixed');
        if (!isSDKTopbar && rect.height > 20 && rect.height < 200) {
          extraNavbars++;
        }
      }
    }

    // Banned CSS libraries — check for their telltale class prefixes or stylesheets
    const allClasses = document.documentElement.innerHTML;
    // Banned CSS libraries — check class names on actual DOM elements, not innerHTML text
    const bannedLibs: string[] = [];
    const allEls = document.querySelectorAll('[class]');
    const classSet = new Set<string>();
    for (const el of allEls) {
      for (const c of el.classList) classSet.add(c);
    }
    const classStr = [...classSet].join(' ');
    if (/\bMui[A-Z]/.test(classStr)) bannedLibs.push('MUI/Material UI');
    if (/\bbootstrap\b/i.test(classStr) || classSet.has('btn-primary') || classSet.has('container-fluid')) bannedLibs.push('Bootstrap');
    if (/\bchakra-/.test(classStr)) bannedLibs.push('Chakra UI');
    if (/\bant-[a-z]/.test(classStr)) bannedLibs.push('Ant Design');

    // Also check CSS frameworks via stylesheets and more class patterns
    if (/\bbtn-outline-/.test(classStr) || classSet.has('form-control')) bannedLibs.push('Bootstrap');
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

    // 2. Tracking / analytics SDKs
    const trackers = [
      'google-analytics', 'googletagmanager', 'gtag', 'ga.js', 'analytics.js',
      'amplitude', 'mixpanel', 'segment', 'hotjar', 'plausible', 'posthog',
      'facebook.net', 'fbevents', 'pixel', 'clarity.ms', 'sentry',
      'newrelic', 'datadog', 'logrocket', 'fullstory', 'heap',
    ];
    for (const t of trackers) {
      if (html.includes(t)) securityIssues.push(`Tracking/analytics: ${t}`);
    }

    // 3. Inline event handlers (XSS vector)
    const inlineHandlers = document.querySelectorAll(
      '[onload], [onerror], [onmouseover], [onfocus], [onblur], [onsubmit]'
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
    const exfil = ['navigator.sendBeacon', 'XMLHttpRequest', 'fetch('].filter(p => {
      // Only flag if pointing to external domains in inline scripts
      for (const s of scripts) {
        if (!s.src && s.textContent?.includes(p)) {
          // Check if it's calling an external URL
          const match = s.textContent.match(new RegExp(p + '\\s*\\(\\s*[\'"`]https?://([^/]+)'));
          if (match && !match[1].includes('freegamestore.online') && !match[1].includes('localhost')) {
            return true;
          }
        }
      }
      return false;
    });
    if (exfil.length > 0) securityIssues.push(`Data exfiltration: ${exfil.join(', ')}`);

    // 8. localStorage/cookie abuse — check for excessive storage
    let storageKeys = 0;
    try { storageKeys = localStorage.length; } catch {}
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
        if (u.origin !== location.origin &&
            !u.hostname.includes('googleapis.com') &&
            (img.width <= 2 || img.height <= 2 || img.naturalWidth <= 2)) {
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
    };
  });
  await checkContext.close();

  const usesSDK = compliance.hasGameShell;
  const hasNoSelect = compliance.hasNoSelect;
  const extraNavbars = compliance.extraNavbars;
  const bannedLibs = compliance.bannedLibs;
  const securityIssues = compliance.securityIssues;

  await browser.close();

  // Compute score
  const passing = new Set<string>();
  for (const vp of viewports) {
    if (vp.pass) passing.add(vp.id);
  }
  const score = computeIndex(passing);

  return { score, loadTimeMs, consoleErrors, viewports, usesSDK, hasNoSelect, extraNavbars, bannedLibs, securityIssues };
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
      if (vp.clippedInteractive > 0) reasons.push(`${vp.clippedInteractive}/${vp.totalInteractive} interactive elements clipped off-screen`);
      if (vp.smallTouchTargets > 0) reasons.push(`${vp.smallTouchTargets} touch targets smaller than 44px`);
      if (vp.contentOverflow > 0) reasons.push(`${vp.contentOverflow} elements render outside viewport`);
      console.log(`  ${id} ${label} \x1b[31m\u2717 ${reasons.join(", ")}\x1b[0m`);
    }
  }

  const maxScore = Math.max(...REFERENCE.map((r) => r.share));
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
    const vpIds = failingVps.map((vp) => vp.id).join(", ");
    console.log(`Touch targets: \x1b[31m\u2717 ${totalSmall} elements below 44px at ${vpIds}\x1b[0m`);
  }

  // Content overflow summary
  const overflowVps = result.viewports.filter((vp) => vp.contentOverflow > 0);
  if (overflowVps.length === 0) {
    console.log(`Content overflow: \x1b[32m\u2713 all content within viewport\x1b[0m`);
  } else {
    const totalOverflow = overflowVps.reduce((sum, vp) => sum + vp.contentOverflow, 0);
    const vpIds = overflowVps.map((vp) => vp.id).join(", ");
    console.log(`Content overflow: \x1b[31m\u2717 ${totalOverflow} elements render outside viewport at ${vpIds}\x1b[0m`);
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
    console.log(`Double topbar: \x1b[31m\u2717 ${result.extraNavbars} extra nav/header elements found — use SDK topbar only\x1b[0m`);
  }

  // Banned CSS libraries check
  if (result.bannedLibs.length === 0) {
    console.log(`CSS libraries: \x1b[32m\u2713 none detected (Tailwind only)\x1b[0m`);
  } else {
    console.log(`CSS libraries: \x1b[31m\u2717 banned: ${result.bannedLibs.join(", ")} — use Tailwind CSS only\x1b[0m`);
  }

  console.log("");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const allMode = args.includes("--all");
  const outputIdx = args.indexOf("--output");
  const outputPath = outputIdx !== -1 ? args[outputIdx + 1] : undefined;

  if (allMode) {
    // Platform mode — read registry and test all games
    const registryPath = resolve(__dirname, "../freegamestore/registry.json");
    const registry = JSON.parse(readFileSync(registryPath, "utf-8"));
    const games: { id: string; name: string; appUrl: string }[] = registry.games || [];

    if (games.length === 0) {
      console.log("No games found in registry.");
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

    const outFile = outputPath || "quality-results.json";
    writeFileSync(outFile, JSON.stringify(output, null, 2));
    console.log(`\nResults written to ${outFile}`);
  } else {
    // Dev mode — single URL
    const url = args.find((a) => !a.startsWith("--"));
    if (!url) {
      console.error("Usage:");
      console.error("  npx tsx audit.ts <url>                          # dev mode");
      console.error("  npx tsx audit.ts --all --output results.json    # platform mode");
      process.exit(1);
    }

    const result = await auditUrl(url);
    printResults(url, result);

    // Exit with non-zero if score is below max
    const maxScore = Math.max(...REFERENCE.map((r) => r.share));
    if (result.score < maxScore) {
      process.exit(1);
    }
  }
}

// Only run main when executed directly (not imported by tests)
const isDirectRun = process.argv[1]?.endsWith("audit.ts");
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
