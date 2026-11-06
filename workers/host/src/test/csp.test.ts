import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyStrictCsp, cspReportResponse, parseReports, REPORT_ONLY_CSP, STRICT_CSP } from '../csp';
import { __clearRouteCache, securityHeaders } from '../host';
import worker from '../index';
import { publicGame } from '../seo';

vi.mock('../seo', async (original) => ({
  ...(await original<typeof import('../seo')>()),
  publicGame: vi.fn(),
  isNoindexResponse: vi.fn().mockResolvedValue(false),
}));

afterEach(() => {
  vi.resetAllMocks();
  __clearRouteCache();
});

const directives = (csp: string) => new Map(csp.split(';').map((d) => d.trim()).map((d) => [d.split(' ')[0]!, d]));

const tokens = (d: string | undefined) => (d ?? '').split(' ').slice(1);

describe('report-only candidate (#454)', () => {
  const rep = directives(REPORT_ONLY_CSP);

  it('is on every response, with the report endpoint', () => {
    const h = securityHeaders({ revalidate: false });
    expect(h.get('content-security-policy-report-only')).toBe(REPORT_ONLY_CSP);
    expect(h.get('reporting-endpoints')).toBe('csp="https://api.freegamestore.online/v1/csp-report"');
    expect(rep.get('report-uri')).toBe('report-uri https://api.freegamestore.online/v1/csp-report');
    expect(rep.get('report-to')).toBe('report-to csp');
  });

  it('drops unsafe-eval and the https: wildcards, which the enforced policy keeps', () => {
    const enforced = directives(securityHeaders({ revalidate: true }).get('content-security-policy')!);
    expect(enforced.get('script-src')).toContain("'unsafe-eval'");
    expect(tokens(rep.get('script-src'))).not.toContain("'unsafe-eval'");
    expect(tokens(rep.get('script-src'))).not.toContain('https:');
    expect(tokens(rep.get('connect-src'))).not.toContain('https:');
    expect(tokens(rep.get('connect-src'))).not.toContain('wss:');
    expect(rep.get('form-action')).toBe("form-action 'self'");
  });

  it('still lets the analytics loader and ingest through', () => {
    expect(rep.get('script-src')).toContain('https://api.freegamestore.online');
    expect(rep.get('connect-src')).toContain('https://api.freegamestore.online');
  });
});

describe('strict policy (opt-in)', () => {
  const strict = directives(STRICT_CSP);

  it('is same-origin plus the platform API and analytics vendors', () => {
    expect(strict.get('default-src')).toBe("default-src 'self'");
    for (const bad of ["'unsafe-eval'", "'unsafe-inline'", 'https:', 'blob:'])
      expect(tokens(strict.get('script-src'))).not.toContain(bad);
    expect(strict.get('script-src')).toContain("'wasm-unsafe-eval'");
    expect(strict.get('script-src')).toContain('https://api.freegamestore.online');
    expect(tokens(strict.get('connect-src'))).not.toContain('https:');
    expect(tokens(strict.get('connect-src'))).not.toContain('wss:');
    expect(strict.get('frame-src')).toBe("frame-src 'none'");
    expect(strict.get('form-action')).toBe("form-action 'self'");
    expect(strict.get('object-src')).toBe("object-src 'none'");
  });

  it('keeps the same frame-ancestors as the open policy', () => {
    const open = directives(securityHeaders({ revalidate: true }).get('content-security-policy')!);
    expect(strict.get('frame-ancestors')).toBe(open.get('frame-ancestors'));
  });

  it('applyStrictCsp replaces the policy and drops the report-only candidate', () => {
    const h = securityHeaders({ revalidate: true });
    applyStrictCsp(h);
    expect(h.get('content-security-policy')).toBe(STRICT_CSP);
    expect(h.has('content-security-policy-report-only')).toBe(false);
  });
});

describe('registry opt-in', () => {
  const route = { slug: 'tidy', zone: 'freegamestore.online', r2_prefix: 'games/tidy', store: 'games' };
  async function hit(path = '/game.js') {
    const obj = { body: 'game', httpEtag: '"v1"', size: 4, range: { offset: 0, length: 2 } };
    const env = {
      DB: { prepare: () => ({ bind: () => ({ first: async () => route }) }) },
      APPS: { get: async () => obj, head: async () => obj },
    };
    const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
    return worker.fetch(new Request(`https://tidy.freegamestore.online${path}`), env as never, ctx);
  }

  it('serves the strict policy only for a literal strictCsp: true', async () => {
    vi.mocked(publicGame).mockResolvedValue({ strictCsp: true } as never);
    expect((await hit()).headers.get('content-security-policy')).toBe(STRICT_CSP);
    for (const value of [undefined, false, 'true', 1]) {
      vi.mocked(publicGame).mockResolvedValue({ strictCsp: value } as never);
      const csp = (await hit()).headers.get('content-security-policy')!;
      expect(csp, String(value)).toContain("'unsafe-eval'");
    }
  });

  it('does not turn on cross-origin isolation by itself', async () => {
    vi.mocked(publicGame).mockResolvedValue({ strictCsp: true } as never);
    expect((await hit()).headers.has('cross-origin-opener-policy')).toBe(false);
  });
});

describe('violation reports', () => {
  const legacy = {
    'csp-report': {
      'document-uri': 'https://2048.freegamestore.online/?x=secret',
      'effective-directive': 'script-src',
      'blocked-uri': 'https://cdn.example.com/lib.js?token=abc',
      disposition: 'report',
    },
  };

  it('parses the legacy format and keeps only the blocked host', () => {
    expect(parseReports(legacy)).toEqual([
      { game: '2048', directive: 'script-src', blocked: 'https://cdn.example.com', disposition: 'report' },
    ]);
  });

  it('parses the Reporting API format and keyword sources', () => {
    expect(
      parseReports([
        {
          type: 'csp-violation',
          body: { documentURL: 'https://pong.freegamestore.online/', effectiveDirective: 'script-src', blockedURL: 'eval' },
        },
        { type: 'deprecation', body: {} },
      ]),
    ).toEqual([{ game: 'pong', directive: 'script-src', blocked: 'eval', disposition: '' }]);
  });

  it('ignores reports for documents outside the game zone', () => {
    expect(
      parseReports({ 'csp-report': { 'document-uri': 'https://evil.test/', 'effective-directive': 'script-src' } }),
    ).toEqual([]);
  });

  const post = (body: string, origin?: string) =>
    new Request('https://api.freegamestore.online/v1/csp-report', {
      method: 'POST',
      headers: { 'content-type': 'application/csp-report', ...(origin ? { origin } : {}) },
      body,
    });

  it('answers 204, logs one deduplicated line per source, and never throws on junk', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const t = 1_000_000_000;
    expect((await cspReportResponse(post(JSON.stringify(legacy)), t)).status).toBe(204);
    await cspReportResponse(post(JSON.stringify(legacy)), t + 1000);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).not.toContain('secret');
    await cspReportResponse(post(JSON.stringify(legacy)), t + 61_000);
    expect(log).toHaveBeenCalledTimes(2);
    for (const junk of ['', 'not json', '[1,2', JSON.stringify({ a: 1 }), 'x'.repeat(20_000)]) {
      expect((await cspReportResponse(post(junk), t)).status).toBe(204);
    }
    log.mockRestore();
  });

  it('answers the preflight for a game origin only, and refuses other methods', async () => {
    const ok = await cspReportResponse(
      new Request('https://api.freegamestore.online/v1/csp-report', { method: 'OPTIONS', headers: { origin: 'https://pong.freegamestore.online' } }),
    );
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://pong.freegamestore.online');
    const evil = await cspReportResponse(
      new Request('https://api.freegamestore.online/v1/csp-report', { method: 'OPTIONS', headers: { origin: 'https://evil.test' } }),
    );
    expect(evil.headers.has('access-control-allow-origin')).toBe(false);
    expect((await cspReportResponse(new Request('https://api.freegamestore.online/v1/csp-report'))).status).toBe(405);
  });

  it('is routed from the api host', async () => {
    const res = await worker.fetch(post(JSON.stringify(legacy)), {} as never, {} as ExecutionContext);
    expect(res.status).toBe(204);
  });
});
