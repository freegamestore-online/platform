import { describe, expect, it } from 'vitest';
import { mapFileSource } from '../lib/file-source.js';
import { checkNoPaymentCapabilities } from './no-payment-capabilities.js';

// #376: FreeGameStore games take no payments. Every way a game could reach the
// browser's payment capabilities fails the check.

const repo = (files: Record<string, string>) => mapFileSource(new Map(Object.entries(files)));
const run = async (files: Record<string, string>) => checkNoPaymentCapabilities(repo(files));

describe('checkNoPaymentCapabilities (#376)', () => {
  it.each([
    [
      'Payment Request API',
      { 'web/src/shop.ts': 'const r = new PaymentRequest(methods, details);' },
    ],
    [
      'feature-detecting PaymentRequest',
      { 'web/src/shop.ts': 'if (window.PaymentRequest) buy();' },
    ],
    [
      'payment handler registration',
      { 'web/src/sw.ts': 'reg.paymentManager.instruments.set(k, i);' },
    ],
    [
      'payment handler event',
      { 'web/src/sw.ts': "self.addEventListener('paymentrequest', onPay);" },
    ],
    ['canmakepayment event', { 'web/src/sw.ts': 'self.addEventListener("canmakepayment", f);' }],
    ['Apple Pay', { 'web/src/pay.tsx': 'const s = new ApplePaySession(3, request);' }],
    [
      'Google Pay script',
      { 'web/index.html': '<script src="https://pay.google.com/gp/p/js/pay.js"></script>' },
    ],
    ['Google Pay client', { 'web/src/pay.ts': 'new google.payments.api.PaymentsClient({})' }],
    [
      'iframe payment delegation',
      { 'web/index.html': '<iframe src="https://x.example" allow="payment"></iframe>' },
    ],
    [
      'iframe delegation in JSX',
      { 'web/src/App.tsx': '<iframe src={u} allow="fullscreen; payment" />' },
    ],
    [
      'manifest payment member',
      {
        'web/public/manifest.json': '{"name":"x","payment":{"supports_delegation":["payerName"]}}',
      },
    ],
    [
      'manifest serviceworker member',
      { 'web/public/app.webmanifest': '{"name":"x","serviceworker":{"src":"/pay-sw.js"}}' },
    ],
    [
      'inline VitePWA manifest member',
      {
        'web/vite.config.ts':
          "VitePWA({ manifest: { name: 'x', serviceworker: { src: '/sw.js' } } })",
      },
    ],
    [
      'declared payment permission',
      {
        'package.json': JSON.stringify({
          freegamestore: { permissions: { payment: 'buy coins' } },
        }),
      },
    ],
    [
      'declared payment permission (array form)',
      { 'package.json': JSON.stringify({ freegamestore: { permissions: ['payment'] } }) },
    ],
  ])('fails on %s', async (_label, files) => {
    const r = await run(files as Record<string, string>);
    expect(r.status).toBe('fail');
    expect(r.suggestions?.[0]).toContain('payment=()');
  });

  it('passes a game that only mentions payments in words, comments or a donation link', async () => {
    const r = await run({
      'web/src/Loan.tsx': [
        '// TODO: maybe a PaymentRequest someday? (no)',
        'export const label = "Monthly payment";',
        'const paymentAmount = principal * rate;',
        '<a href="https://ko-fi.com/creator">Buy me a coffee</a>',
      ].join('\n'),
      'web/index.html':
        '<!-- <iframe allow="payment"> --><iframe allow="fullscreen; gamepad"></iframe>',
      'web/public/manifest.json': '{"name":"Loan","short_name":"Loan","display":"standalone"}',
      'web/vite.config.ts': "VitePWA({ registerType: 'autoUpdate', manifest: { name: 'Loan' } })",
      'package.json': JSON.stringify({ freegamestore: { permissions: { gamepad: '' } } }),
    });
    expect(r).toMatchObject({ status: 'pass' });
  });

  it('ignores vendored files outside web/src', async () => {
    const r = await run({ 'web/public/vendor/engine.js': 'new PaymentRequest(a, b)' });
    expect(r.status).toBe('pass');
  });

  it('lists where each finding is', async () => {
    const r = await run({
      'web/src/a.ts': 'new PaymentRequest(m, d)',
      'web/public/manifest.json': '{"serviceworker":{}}',
    });
    expect(r.detail).toContain('Payment Request API (PaymentRequest) in web/src/a.ts');
    expect(r.detail).toContain('manifest member "serviceworker" in web/public/manifest.json');
  });
});
