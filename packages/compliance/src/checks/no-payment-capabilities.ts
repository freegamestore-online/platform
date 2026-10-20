import type { FileSource } from '../lib/file-source.js';
import { extOf } from '../lib/path.js';
import { stripCommentsAndStrings, stripCommentsOnly, stripHtmlComments } from '../lib/strip.js';
import type { CheckResult } from '../types.js';

const NAME = 'No payment capabilities';

/**
 * FreeGameStore games take NO payments (#376, owner decision 2026-10-20). The
 * host already sends `Permissions-Policy: payment=()` on every game response,
 * so the browser refuses these APIs anyway. This check fails the build so the
 * creator learns at `fgs check` / CI time rather than from a broken game.
 *
 * Covers the browser's own payment capabilities. Provider SDKs, checkout
 * endpoints and their dependencies are no-payment-sdk's job.
 *   - Payment Request API (`PaymentRequest`)
 *   - Payment Handler API (`paymentManager`, `PaymentRequestEvent`, the
 *     `paymentrequest` / `canmakepayment` service-worker events)
 *   - Apple Pay JS (`ApplePaySession`) and Google Pay JS (`pay.google.com`,
 *     `google.payments`)
 *   - delegating payment to an iframe (`allow="payment"`)
 *   - payment members in the web app manifest: `payment*`, and
 *     `serviceworker`, which Chrome uses only to install a payment handler
 *   - declaring `payment` in package.json `freegamestore.permissions`
 *
 * The plain word "payment" is fine: a loan calculator or a shop-themed game
 * passes. So is a link to the creator's own donation page, which is not the
 * game taking a payment.
 */

/** Identifiers, matched on code with comments AND strings stripped. */
const CODE_PATTERNS: Array<[string, RegExp]> = [
  ['Payment Request API (PaymentRequest)', /\bPaymentRequest\b/],
  ['Payment Handler API (paymentManager)', /\bpaymentManager\b/],
  ['Payment Handler API (PaymentRequestEvent)', /\bPaymentRequestEvent\b/],
  ['Apple Pay (ApplePaySession)', /\bApplePaySession\b/],
  ['Google Pay (google.payments)', /\bgoogle\s*\.\s*payments\b/],
];

/** Event names and hosts live in strings: matched with comments stripped only. */
const STRING_PATTERNS: Array<[string, RegExp]> = [
  ['payment handler event (paymentrequest)', /['"`]paymentrequest['"`]/],
  ['payment handler event (canmakepayment)', /['"`]canmakepayment['"`]/],
  ['Google Pay (pay.google.com)', /\bpay\.google\.com\b/],
  ['iframe payment delegation (allow="payment")', /\ballow\s*=\s*\{?\s*["'`][^"'`]*\bpayment\b/],
];

const CODE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.html']);
const MANIFEST_KEY = /^(?:payment\w*|serviceworker)$/i;

function scanned(path: string): boolean {
  return path === 'web/index.html' || path.startsWith('web/src/');
}

function manifestProblems(json: string): string[] {
  try {
    const manifest = JSON.parse(json) as unknown;
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return [];
    return Object.keys(manifest).filter((k) => MANIFEST_KEY.test(k));
  } catch {
    return [];
  }
}

export async function checkNoPaymentCapabilities(source: FileSource): Promise<CheckResult> {
  const findings: string[] = [];
  const note = (what: string, where: string) => findings.push(`${what} in ${where}`);

  for await (const path of source.list()) {
    const ext = extOf(path);

    if (scanned(path) && CODE_EXTS.has(ext)) {
      const raw = await source.read(path);
      if (!raw) continue;
      const commentless = ext === '.html' ? stripHtmlComments(raw) : stripCommentsOnly(raw);
      const codeOnly = ext === '.html' ? commentless : stripCommentsAndStrings(raw);
      for (const [what, re] of CODE_PATTERNS) if (re.test(codeOnly)) note(what, path);
      for (const [what, re] of STRING_PATTERNS) if (re.test(commentless)) note(what, path);
      continue;
    }

    // Web app manifests: a static manifest.json or any .webmanifest.
    if (path === 'web/public/manifest.json' || ext === '.webmanifest') {
      const raw = await source.read(path);
      for (const key of raw ? manifestProblems(raw) : []) note(`manifest member "${key}"`, path);
      continue;
    }

    // vite-plugin-pwa's inline manifest. Neither key is a VitePWA option, so a
    // match in the config can only be a manifest member.
    if (/^web\/vite\.config\.[cm]?[jt]s$/.test(path)) {
      const raw = await source.read(path);
      const text = raw ? stripCommentsOnly(raw) : '';
      for (const m of text.matchAll(/(?:^|[\s,{])['"]?(payment\w*|serviceworker)['"]?\s*:/gi)) {
        note(`manifest member "${m[1]}"`, path);
      }
    }
  }

  // A declared payment permission (#370 declarations).
  const pkg = await source.read('package.json');
  if (pkg) {
    try {
      const permissions = (JSON.parse(pkg) as { freegamestore?: { permissions?: unknown } })
        .freegamestore?.permissions;
      const ids = Array.isArray(permissions)
        ? permissions.map((p) => (typeof p === 'string' ? p : (p as { id?: unknown })?.id))
        : permissions && typeof permissions === 'object'
          ? Object.keys(permissions)
          : [];
      if (ids.some((id) => typeof id === 'string' && id.trim().toLowerCase() === 'payment')) {
        note('declared "payment" permission', 'package.json');
      }
    } catch {
      // permissions-declared reports an unreadable package.json.
    }
  }

  if (findings.length === 0) {
    return {
      name: NAME,
      status: 'pass',
      detail: 'no payment APIs, delegation or manifest members',
    };
  }
  return {
    name: NAME,
    status: 'fail',
    detail: `${findings.length} payment capabilit${findings.length === 1 ? 'y' : 'ies'}: ${findings.slice(0, 4).join('; ')}${findings.length > 4 ? '; …' : ''}`,
    suggestions: [
      'FreeGameStore games are free and take no payments: the host blocks the Payment Request API (Permissions-Policy payment=()). Remove the payment code.',
      'A link to your own donation or sponsor page is fine. Paid games belong on ProGameStore.',
    ],
  };
}
