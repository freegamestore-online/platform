import { describe, expect, it } from 'vitest';
import { corsHeaders } from './cors';

const DOMAIN = 'freegamestore.online';
const req = (origin?: string) =>
  new Request('https://api.test/x', origin ? { headers: { Origin: origin } } : {});

describe('corsHeaders', () => {
  it.each([`https://console.${DOMAIN}`, `https://publish.${DOMAIN}`])(
    'reflects the first-party origin %s with credentials',
    (origin) => {
      const h = corsHeaders(req(origin), DOMAIN);
      expect(h['Access-Control-Allow-Origin']).toBe(origin);
      expect(h['Access-Control-Allow-Credentials']).toBe('true');
    },
  );

  it.each([
    'https://evil.freegamestore.online', // a game subdomain
    'https://freegamestore.online',
    'http://localhost:5173', // trusted per deployment by the caller, never here (#486)
    'https://console.freegamestore.online.evil.test',
    'null',
  ])('never reflects %s: answers the console origin instead', (origin) => {
    expect(corsHeaders(req(origin), DOMAIN)['Access-Control-Allow-Origin']).toBe(
      `https://console.${DOMAIN}`,
    );
  });

  it('answers the console origin when there is no Origin header', () => {
    expect(corsHeaders(req(), DOMAIN)['Access-Control-Allow-Origin']).toBe(
      `https://console.${DOMAIN}`,
    );
  });

  it('allows the methods and header the APIs use, and nothing wildcard', () => {
    const h = corsHeaders(req(`https://console.${DOMAIN}`), DOMAIN);
    expect(h['Access-Control-Allow-Methods']).toBe('GET, POST, PUT, DELETE, OPTIONS');
    expect(h['Access-Control-Allow-Headers']).toBe('Content-Type');
    expect(Object.values(h)).not.toContain('*');
  });
});
