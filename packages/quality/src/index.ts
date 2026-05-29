/**
 * Quality reporter for FreeGameStore games.
 *
 * When a game is loaded inside an iframe (i.e. by the platform Quality
 * Dashboard at https://freegamestore.online/quality), this reporter posts
 * viewport / overflow / clipping metrics back to the parent so the
 * dashboard can audit layout fit at every reference viewport without
 * needing same-origin DOM access.
 *
 * In production (top-level navigation) the reporter is a no-op — there's
 * no parent to receive messages, so we don't waste CPU.
 *
 * Privacy note: posts contain ONLY viewport / DOM-shape numbers. No URLs
 * (parent already knows), no localStorage, no user content, no identifiers.
 * Games remain fully privacy-first; this is structural metadata for QA only.
 *
 * Forked from @freeappstore/quality. Uses `fgs:quality` as the message
 * type. The dashboard listener accepts both `fgs:quality` and `fas:quality`
 * for backwards compatibility with games that still use the FAS package.
 */

export interface ViewportReport {
  type: 'fgs:quality';
  schema: 1;
  capturedAt: number;
  appId: string;
  viewport: { width: number; height: number };
  document: {
    scrollWidth: number;
    scrollHeight: number;
    clientWidth: number;
    clientHeight: number;
    scrollsX: boolean;
    scrollsY: boolean;
  };
  clipping: ClippingHit[];
  colorScheme: 'light' | 'dark' | 'unknown';
  reducedMotion: boolean;
  reporterVersion: string;
}

export interface ClippingHit {
  selector: string;
  scrollWidth: number;
  scrollHeight: number;
  clientWidth: number;
  clientHeight: number;
  clipsX: boolean;
  clipsY: boolean;
}

const REPORTER_VERSION = '0.1.0';
const TOLERANCE_PX = 1;
const MAX_CLIPPING_HITS = 20;

function shouldReport(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.parent === window) return false;
  if ((window as unknown as { __FGS_QUALITY_DISABLE?: boolean }).__FGS_QUALITY_DISABLE)
    return false;
  return true;
}

export function snapshot(): ViewportReport {
  const root = typeof document !== 'undefined' ? document.documentElement : null;
  const w = typeof window !== 'undefined' ? window : (undefined as unknown as Window);

  const fallback = (): ViewportReport => ({
    type: 'fgs:quality',
    schema: 1,
    capturedAt: Date.now(),
    appId: '',
    viewport: { width: 0, height: 0 },
    document: {
      scrollWidth: 0,
      scrollHeight: 0,
      clientWidth: 0,
      clientHeight: 0,
      scrollsX: false,
      scrollsY: false,
    },
    clipping: [],
    colorScheme: 'unknown',
    reducedMotion: false,
    reporterVersion: REPORTER_VERSION,
  });

  if (!root) return fallback();

  const clipping: ClippingHit[] = [];
  const all = document.querySelectorAll('*');
  for (let i = 0; i < all.length && clipping.length < MAX_CLIPPING_HITS; i++) {
    const el = all[i] as HTMLElement;
    const cs = getComputedStyle(el);
    const ovx = cs.overflowX;
    const ovy = cs.overflowY;
    const xClipped =
      (ovx === 'hidden' || ovx === 'clip') && el.scrollWidth > el.clientWidth + TOLERANCE_PX;
    const yClipped =
      (ovy === 'hidden' || ovy === 'clip') && el.scrollHeight > el.clientHeight + TOLERANCE_PX;
    if (!xClipped && !yClipped) continue;
    const idPart = el.id ? `#${el.id}` : '';
    const classPart =
      el.className && typeof el.className === 'string'
        ? `.${el.className.split(/\s+/).filter(Boolean)[0] ?? ''}`
        : '';
    clipping.push({
      selector: `${el.tagName.toLowerCase()}${idPart}${classPart}`,
      scrollWidth: el.scrollWidth,
      scrollHeight: el.scrollHeight,
      clientWidth: el.clientWidth,
      clientHeight: el.clientHeight,
      clipsX: xClipped,
      clipsY: yClipped,
    });
  }

  const colorScheme: 'light' | 'dark' | 'unknown' =
    typeof matchMedia === 'function'
      ? matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : 'unknown';
  const reducedMotion =
    typeof matchMedia === 'function'
      ? matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;

  const host = w.location.hostname;
  const m = /^([^.]+)\.freegamestore\.online$/.exec(host);
  const appId = m?.[1] ?? '';

  return {
    type: 'fgs:quality',
    schema: 1,
    capturedAt: Date.now(),
    appId,
    viewport: { width: w.innerWidth, height: w.innerHeight },
    document: {
      scrollWidth: root.scrollWidth,
      scrollHeight: root.scrollHeight,
      clientWidth: root.clientWidth,
      clientHeight: root.clientHeight,
      scrollsX: root.scrollWidth > root.clientWidth + TOLERANCE_PX,
      scrollsY: root.scrollHeight > root.clientHeight + TOLERANCE_PX,
    },
    clipping,
    colorScheme,
    reducedMotion,
    reporterVersion: REPORTER_VERSION,
  };
}

interface ReporterHandle {
  stop(): void;
  reportNow(): void;
}

export const REFERENCE_VIEWPORTS: ReadonlyArray<{
  width: number;
  height: number;
  label: string;
  orientation: 'portrait' | 'landscape';
  share: number;
  kind: 'phone' | 'tablet';
}> = [
  {
    width: 320,
    height: 568,
    label: 'iPhone SE',
    orientation: 'portrait',
    share: 99,
    kind: 'phone',
  },
  { width: 360, height: 800, label: 'Android', orientation: 'portrait', share: 96, kind: 'phone' },
  {
    width: 393,
    height: 852,
    label: 'iPhone 15',
    orientation: 'portrait',
    share: 92,
    kind: 'phone',
  },
  {
    width: 414,
    height: 896,
    label: 'iPhone 11 PM',
    orientation: 'portrait',
    share: 88,
    kind: 'phone',
  },
  { width: 600, height: 800, label: 'Tablet', orientation: 'portrait', share: 60, kind: 'tablet' },
  { width: 768, height: 1024, label: 'iPad', orientation: 'portrait', share: 35, kind: 'tablet' },
  {
    width: 1024,
    height: 1366,
    label: 'iPad Pro',
    orientation: 'portrait',
    share: 20,
    kind: 'tablet',
  },
  {
    width: 568,
    height: 320,
    label: 'iPhone SE land.',
    orientation: 'landscape',
    share: 99,
    kind: 'phone',
  },
  {
    width: 667,
    height: 375,
    label: 'iPhone 8 land.',
    orientation: 'landscape',
    share: 96,
    kind: 'phone',
  },
  {
    width: 736,
    height: 414,
    label: 'iPhone+ land.',
    orientation: 'landscape',
    share: 88,
    kind: 'phone',
  },
  {
    width: 800,
    height: 600,
    label: 'Tablet land.',
    orientation: 'landscape',
    share: 60,
    kind: 'tablet',
  },
  {
    width: 1024,
    height: 768,
    label: 'iPad land.',
    orientation: 'landscape',
    share: 35,
    kind: 'tablet',
  },
  {
    width: 1366,
    height: 1024,
    label: 'iPad Pro land.',
    orientation: 'landscape',
    share: 20,
    kind: 'tablet',
  },
];

export function computeQualityIndex(
  matrix: ReadonlyArray<{
    width: number;
    height: number;
    orientation: 'portrait' | 'landscape';
    share: number;
  }>,
  passingKeys: ReadonlySet<string>,
): { portrait: number; landscape: number; overall: number } {
  const score = (orientation: 'portrait' | 'landscape'): number => {
    const inOrientation = matrix
      .filter((v) => v.orientation === orientation)
      .slice()
      .sort((a, b) => a.width - b.width);
    if (inOrientation.length === 0) return -1;
    let total = 0;
    for (let i = 0; i < inOrientation.length; i++) {
      const v = inOrientation[i]!;
      const next = inOrientation[i + 1];
      const bucketShare = next ? v.share - next.share : v.share;
      const key = `${orientation}:${v.width}x${v.height}`;
      if (passingKeys.has(key)) total += bucketShare;
    }
    return Math.round(total);
  };
  const portrait = score('portrait');
  const landscape = score('landscape');
  const haveP = portrait >= 0;
  const haveL = landscape >= 0;
  let overall: number;
  if (haveP && haveL) overall = Math.min(portrait, landscape);
  else if (haveP) overall = portrait;
  else overall = Math.max(0, landscape);
  return {
    portrait: haveP ? portrait : 0,
    landscape: haveL ? landscape : 0,
    overall,
  };
}

export function viewportKey(v: {
  width: number;
  height: number;
  orientation: 'portrait' | 'landscape';
}): string {
  return `${v.orientation}:${v.width}x${v.height}`;
}

export function initQualityReporter(): ReporterHandle {
  const w = typeof window !== 'undefined' ? window : null;
  if (!w) return { stop: () => undefined, reportNow: () => undefined };
  const existing = (w as unknown as { __FGS_QUALITY_REPORTER__?: ReporterHandle })
    .__FGS_QUALITY_REPORTER__;
  if (existing) return existing;

  if (!shouldReport()) {
    const noop: ReporterHandle = { stop: () => undefined, reportNow: () => undefined };
    (w as unknown as { __FGS_QUALITY_REPORTER__?: ReporterHandle }).__FGS_QUALITY_REPORTER__ = noop;
    return noop;
  }

  const post = () => {
    try {
      w.parent.postMessage(snapshot(), '*');
    } catch {
      // Parent may have closed or set restrictive CSP; nothing to do.
    }
  };

  const initialPost = () => {
    post();
    setTimeout(post, 250);
    setTimeout(post, 1500);
  };

  const onResize = () => post();
  const onMessage = (e: MessageEvent) => {
    const data = e.data as { type?: string } | null;
    // Accept both fgs and fas request messages for backwards compat
    if (data && (data.type === 'fgs:quality:request' || data.type === 'fas:quality:request'))
      post();
  };

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initialPost();
  } else {
    document.addEventListener('DOMContentLoaded', initialPost, { once: true });
  }
  w.addEventListener('resize', onResize);
  w.addEventListener('message', onMessage);

  const handle: ReporterHandle = {
    stop: () => {
      w.removeEventListener('resize', onResize);
      w.removeEventListener('message', onMessage);
      delete (w as unknown as { __FGS_QUALITY_REPORTER__?: ReporterHandle })
        .__FGS_QUALITY_REPORTER__;
    },
    reportNow: post,
  };
  (w as unknown as { __FGS_QUALITY_REPORTER__?: ReporterHandle }).__FGS_QUALITY_REPORTER__ = handle;
  return handle;
}
