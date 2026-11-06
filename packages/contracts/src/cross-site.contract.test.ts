import { describe, expect, it } from 'vitest';
import {
  declaresBody,
  rejectCrossSite,
  requireJsonBody,
} from '../../../contracts/cross-site/v1/contract';

const ORIGINS = ['https://console.freegamestore.online', 'https://freegamestore.online'];
const post = (headers: Record<string, string> = {}, method = 'POST', body?: string) =>
  new Request('https://x.test/api/y', { method, headers, body });

describe('rejectCrossSite', () => {
  it.each(['GET', 'HEAD', 'OPTIONS'])('lets safe method %s through untouched', (method) => {
    expect(
      rejectCrossSite(post({ Origin: 'https://evil.test' }, method), { origins: ORIGINS }),
    ).toBeNull();
  });

  it('allows each first-party origin and refuses a game subdomain, null and look-alikes', async () => {
    for (const o of ORIGINS)
      expect(rejectCrossSite(post({ Origin: o }), { origins: ORIGINS })).toBeNull();
    for (const o of [
      'https://game.freegamestore.online',
      'null',
      'https://console.freegamestore.online.evil.test',
      'http://console.freegamestore.online',
    ]) {
      const res = rejectCrossSite(post({ Origin: o }), { origins: ORIGINS });
      expect(res?.status, o).toBe(403);
    }
  });

  it('with no Origin, trusts only Sec-Fetch-Site: same-origin', () => {
    expect(
      rejectCrossSite(post({ 'Sec-Fetch-Site': 'same-origin' }), { origins: ORIGINS }),
    ).toBeNull();
    expect(
      rejectCrossSite(post({ 'Sec-Fetch-Site': 'same-site' }), { origins: ORIGINS })?.status,
    ).toBe(403);
    expect(rejectCrossSite(post(), { origins: ORIGINS })?.status).toBe(403);
  });

  it('trusts the dev origin only when it is passed (#486)', () => {
    const r = () => post({ Origin: 'http://localhost:5173' });
    expect(rejectCrossSite(r(), { origins: ORIGINS })?.status).toBe(403);
    expect(rejectCrossSite(r(), { origins: ORIGINS, devOrigin: undefined })?.status).toBe(403);
    expect(
      rejectCrossSite(r(), { origins: ORIGINS, devOrigin: 'http://localhost:5173' }),
    ).toBeNull();
  });

  it('demands JSON only when the handler opts in', async () => {
    const first = { Origin: ORIGINS[0]!, 'Content-Type': 'text/plain' };
    expect(rejectCrossSite(post(first), { origins: ORIGINS })).toBeNull();
    const res = rejectCrossSite(post(first), { origins: ORIGINS, body: true });
    expect(res?.status).toBe(415);
    expect(
      rejectCrossSite(
        post({ Origin: ORIGINS[0]!, 'Content-Type': 'Application/JSON; charset=utf-8' }),
        {
          origins: ORIGINS,
          body: true,
        },
      ),
    ).toBeNull();
  });

  it('puts extra headers on the refusal', () => {
    const res = rejectCrossSite(post({ Origin: 'https://evil.test' }), {
      origins: ORIGINS,
      headers: { 'Access-Control-Allow-Origin': 'https://console.freegamestore.online' },
    });
    expect(res?.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://console.freegamestore.online',
    );
    expect(res?.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('declaresBody', () => {
  it('is false for a body-less browser POST (no Content-Type, Content-Length 0)', () => {
    expect(declaresBody(post({ 'Content-Length': '0' }))).toBe(false);
    expect(declaresBody(post())).toBe(false);
  });
  it('is true for a Content-Type, a length or a transfer encoding', () => {
    expect(declaresBody(post({ 'Content-Type': 'text/plain' }))).toBe(true);
    expect(declaresBody(post({ 'Content-Length': '2' }))).toBe(true);
    expect(declaresBody(post({ 'Transfer-Encoding': 'chunked' }))).toBe(true);
    expect(declaresBody(post({}, 'POST', '{}'))).toBe(true);
  });
});

describe('requireJsonBody', () => {
  it('415s a non-JSON request and passes JSON', () => {
    expect(requireJsonBody(post({ 'Content-Type': 'text/plain' }))?.status).toBe(415);
    expect(requireJsonBody(post())?.status).toBe(415);
    expect(requireJsonBody(post({ 'Content-Type': 'application/json' }))).toBeNull();
  });
});
