import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runDoctor } from './doctor.js';

beforeEach(() => {
  // Provide a fast, deterministic /health response unless a test overrides.
  globalThis.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ ok: true }), { status: 200 }),
  );
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>)['fetch'];
  vi.restoreAllMocks();
});

describe('runDoctor', () => {
  it('runs all 6 expected checks and returns them in stable order', async () => {
    const results = await runDoctor();
    const names = results.map((r) => r.name);
    expect(names).toEqual([
      'Node version',
      'git installed',
      'pnpm installed',
      'Config file',
      'Signed in',
      'API reachable',
    ]);
  });

  it('flags Node < 22 as fail', async () => {
    const original = process.versions;
    Object.defineProperty(process, 'versions', {
      value: { ...original, node: '20.0.0' },
      configurable: true,
    });
    try {
      const results = await runDoctor();
      const node = results.find((r) => r.name === 'Node version');
      expect(node?.status).toBe('fail');
      expect(node?.detail).toContain('20.0.0');
    } finally {
      Object.defineProperty(process, 'versions', { value: original, configurable: true });
    }
  });

  it('marks API reachable as fail on 5xx', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('boom', { status: 503 }));
    const results = await runDoctor();
    const api = results.find((r) => r.name === 'API reachable');
    expect(api?.status).toBe('fail');
    expect(api?.detail).toContain('503');
  });

  it('marks API reachable as fail on network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
    const results = await runDoctor();
    const api = results.find((r) => r.name === 'API reachable');
    expect(api?.status).toBe('fail');
    expect(api?.detail).toContain('ENOTFOUND');
  });

  it('all check results have a non-empty name and detail', async () => {
    const results = await runDoctor();
    for (const r of results) {
      expect(r.name.length).toBeGreaterThan(0);
      expect(r.detail.length).toBeGreaterThan(0);
      expect(['pass', 'warn', 'fail']).toContain(r.status);
    }
  });
});
