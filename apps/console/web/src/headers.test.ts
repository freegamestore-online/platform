/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import indexHtml from '../index.html?raw';
import headersFile from '../public/_headers?raw';

// public/_headers is copied into the Pages build as-is; Pages applies it to
// static assets only, never to the /api/* and /auth/* Functions (#465).
const rules: Record<string, string> = {};
for (const line of headersFile.split('\n')) {
  if (!line.startsWith('  ')) continue;
  const [name, value] = line.trim().split(/:\s(.*)/s);
  if (name && value) rules[name.toLowerCase()] = value;
}
const csp = rules['content-security-policy'] ?? '';
const directive = (name: string) =>
  csp.split('; ').find((d) => d === name || d.startsWith(`${name} `)) ?? '';

describe('console security headers', () => {
  it('apply to every static path', () => {
    expect(
      headersFile.split('\n').filter((line) => /^\S/.test(line) && !line.startsWith('#')),
    ).toEqual(['/*']);
  });

  it('cannot be framed', () => {
    expect(directive('frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(rules['x-frame-options']).toBe('DENY');
  });

  it('allows no inline, eval or third-party script beyond the hashed boot script in index.html', async () => {
    // No @types/node in this tsconfig: load the hash function by a non-literal specifier.
    const nodeCrypto = 'node:crypto';
    const { createHash } = (await import(/* @vite-ignore */ nodeCrypto)) as {
      createHash(alg: string): { update(data: string): { digest(enc: 'base64'): string } };
    };
    const inline = [...indexHtml.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
      (m) =>
        `'sha256-${createHash('sha256')
          .update(m[1] ?? '')
          .digest('base64')}'`,
    );
    expect(inline).toHaveLength(1);
    expect(directive('script-src')).toBe(`script-src 'self' ${inline.join(' ')}`);
    expect(csp).not.toContain("'unsafe-eval'");
    expect(directive('default-src')).toBe("default-src 'self'");
  });

  it('reaches only the platform origins the console calls', () => {
    expect(directive('connect-src')).toBe("connect-src 'self' https://*.freegamestore.online");
    expect(directive('frame-src')).toBe('frame-src https://*.freegamestore.online');
    expect(directive('form-action')).toBe("form-action 'self'");
    expect(directive('base-uri')).toBe("base-uri 'self'");
    expect(directive('object-src')).toBe("object-src 'none'");
    expect(rules['x-content-type-options']).toBe('nosniff');
    expect(rules['strict-transport-security']).toContain('includeSubDomains');
  });
});
