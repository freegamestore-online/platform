import { describe, expect, it } from 'vitest';
import {
  AUTH_ORIGIN,
  handoffFormPage,
  readHandoff,
} from '../../../contracts/handoff-delivery/v1/contract';

const TARGET = 'https://console.freegamestore.online';
const form = (fields: Record<string, string>, origin?: string) =>
  new Request(`${TARGET}/auth/handoff`, {
    method: 'POST',
    headers: origin ? { Origin: origin } : {},
    body: new URLSearchParams(fields),
  });

describe('handoffFormPage', () => {
  it('is a 200 page that POSTs the token to the target, with the token nowhere in a URL', async () => {
    const res = await handoffFormPage(TARGET, 'a.b.c', `${TARGET}/dashboard`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`method="post" action="${TARGET}/auth/handoff"`);
    expect(html).toContain('name="token" value="a.b.c"');
    expect(html).not.toMatch(/\?token=/);
  });

  it('escapes values so a hostile return_to cannot break out of the attribute', async () => {
    const html = await (await handoffFormPage(TARGET, 't', '"><script>alert(1)</script>')).text();
    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });

  it('sends a CSP that allows only its one script and the target form, and Referrer-Policy origin', async () => {
    const res = await handoffFormPage(TARGET, 't', TARGET);
    const csp = res.headers.get('content-security-policy')!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain(`form-action ${TARGET}`);
    expect(csp).not.toContain('unsafe-inline');
    // The hash in the CSP is the hash of the inline script in the page.
    const script = /<script>(.*?)<\/script>/.exec(await res.text())![1]!;
    const digest = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(script)),
    );
    expect(csp).toContain(`'sha256-${btoa(String.fromCharCode(...digest))}'`);
    expect(res.headers.get('referrer-policy')).toBe('origin');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('readHandoff', () => {
  it('reads a POST from the auth origin', async () => {
    expect(
      await readHandoff(form({ token: 'tok', return_to: 'https://x/' }, AUTH_ORIGIN), AUTH_ORIGIN),
    ).toEqual({
      token: 'tok',
      returnTo: 'https://x/',
    });
  });

  it.each([
    ['a game page', 'https://evil.freegamestore.online'],
    ['an opaque origin', 'null'],
    ['no Origin', undefined],
  ])('refuses a POST from %s', async (_name, origin) => {
    expect(await readHandoff(form({ token: 'tok' }, origin), AUTH_ORIGIN)).toBeNull();
  });

  it('refuses a POST with no token', async () => {
    expect(await readHandoff(form({ return_to: 'x' }, AUTH_ORIGIN), AUTH_ORIGIN)).toBeNull();
  });

  it('never reads a token from a GET query (the old delivery)', async () => {
    const get = new Request(`${TARGET}/auth/handoff?token=tok&return_to=r`);
    expect(await readHandoff(get, AUTH_ORIGIN)).toBeNull();
  });
});
