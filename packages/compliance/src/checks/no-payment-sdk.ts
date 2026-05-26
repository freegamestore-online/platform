import type { FileSource } from '../lib/file-source.js';
import { stripCommentsForExt } from '../lib/strip.js';
import type { CheckResult } from '../types.js';

// Each payment provider carries one or more patterns that match real SDK
// usage — scoped imports, hostnames, function calls — not bare English
// words. Same approach as no-tracking.ts.
type PaymentSpec = {
  name: string;
  patterns: RegExp[];
};

const PAYMENT_SDKS: PaymentSpec[] = [
  {
    name: 'stripe',
    patterns: [
      /@stripe\//i,
      /stripe\.com/i,
      /from\s+['"]stripe['"]/i,
      /require\(['"]stripe['"]\)/i,
      /\bStripe\s*\(/i,
      /\bloadStripe\b/i,
    ],
  },
  {
    name: 'paypal',
    patterns: [
      /@paypal\//i,
      /paypal\.com\/sdk/i,
      /paypalobjects\.com/i,
      /from\s+['"]@paypal\//i,
    ],
  },
  {
    name: 'braintree',
    patterns: [
      /braintree-web/i,
      /braintreegateway/i,
      /from\s+['"]braintree/i,
      /require\(['"]braintree/i,
    ],
  },
  {
    name: 'square',
    patterns: [
      /@square\//i,
      /squareup\.com/i,
      /from\s+['"]square['"]/i,
      /require\(['"]square['"]\)/i,
    ],
  },
  {
    name: 'paddle',
    patterns: [
      /@paddle\//i,
      /paddle\.com/i,
      /from\s+['"]@paddle\//i,
      /\bPaddle\s*\.\s*(?:Setup|Checkout|Environment)\b/i,
    ],
  },
  {
    name: 'lemonsqueezy',
    patterns: [
      /@lemonsqueezy\//i,
      /lemonsqueezy\.com/i,
      /from\s+['"]@lemonsqueezy\//i,
    ],
  },
  {
    name: 'revenuecat',
    patterns: [
      /@revenuecat\//i,
      /revenuecat\.com/i,
      /from\s+['"]@revenuecat\//i,
      /\bPurchases\s*\.\s*configure\b/i,
    ],
  },
];

const SCAN_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.html', '.json']);

/**
 * Games on freegamestore.online must be free forever — no payment SDKs
 * allowed. Scans source files for imports/usage of Stripe, PayPal,
 * Braintree, Square, Paddle, LemonSqueezy, and RevenueCat.
 *
 * Uses comment-stripping (preserving string contents) so that real
 * `import from "stripe"` is caught but a `// TODO: evaluate stripe`
 * comment isn't.
 */
export async function checkNoPaymentSdk(source: FileSource): Promise<CheckResult> {
  const hits: { file: string; matches: string[] }[] = [];

  for await (const path of source.list()) {
    const ext = extOf(path);
    if (!SCAN_EXTS.has(ext)) continue;
    const raw = await source.read(path);
    if (!raw) continue;
    const content = stripCommentsForExt(raw, ext);
    const matches = PAYMENT_SDKS.filter((s) => s.patterns.some((re) => re.test(content))).map(
      (s) => s.name,
    );
    if (matches.length > 0) {
      hits.push({ file: path, matches });
    }
  }

  if (hits.length === 0) {
    return {
      name: 'No payment SDKs',
      status: 'pass',
      detail: 'no payment SDK imports found — game is free forever',
    };
  }

  return {
    name: 'No payment SDKs',
    status: 'fail',
    detail: `${hits.length} file(s) reference payment SDKs: ${hits
      .slice(0, 3)
      .map((h) => `${h.file} (${h.matches.join(', ')})`)
      .join('; ')}${hits.length > 3 ? '...' : ''}`,
    suggestions: [
      'Remove all payment SDK dependencies. Games on FreeGameStore must be 100% free — no in-app purchases, subscriptions, or payment flows.',
      'If you need monetisation, publish on ProGameStore (progamestore.online) instead.',
    ],
  };
}

function extOf(path: string): string {
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  return dot > slash ? path.slice(dot).toLowerCase() : '';
}
