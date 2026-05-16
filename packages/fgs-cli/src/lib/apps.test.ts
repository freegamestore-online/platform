import { describe, it, expect } from 'vitest';
import { APPS, cfProjectFor, urlFor } from './apps.js';

describe('cfProjectFor', () => {
  it('returns the registered cfProject for known non-conventional games', () => {
    expect(cfProjectFor('puzzle')).toBe('freepuzzle');
  });

  it('falls back to free<id>app convention for games not in the registry', () => {
    // Games follow `free<id>app` even though the convention reads
    // app-flavored — Cloudflare Pages project namespaces are shared
    // across stores and most games adopted the existing pattern.
    expect(cfProjectFor('tetris')).toBe('freetetrisapp');
    expect(cfProjectFor('asteroids')).toBe('freeasteroidsapp');
    expect(cfProjectFor('hangman')).toBe('freehangmanapp');
  });
});

describe('urlFor', () => {
  it('returns the registered subdomain for non-conventional games', () => {
    expect(urlFor('puzzle')).toBe('https://puzzle.freegamestore.online');
  });

  it('falls back to <id>.freegamestore.online (NOT freeappstore.online)', () => {
    // Regression test for a real bug: the file was copied verbatim from
    // fas-cli and the default fallback routed `fgs logs/publish/list` at
    // *.freeappstore.online — wrong store, silent failure.
    expect(urlFor('tetris')).toBe('https://tetris.freegamestore.online');
    expect(urlFor('asteroids')).toBe('https://asteroids.freegamestore.online');
    expect(urlFor('hangman')).toBe('https://hangman.freegamestore.online');
  });
});

describe('APPS registry', () => {
  it('all entries have non-empty cfProject and subdomain', () => {
    for (const [id, record] of Object.entries(APPS)) {
      expect(record.cfProject, `cfProject for ${id}`).toBeTruthy();
      expect(record.subdomain, `subdomain for ${id}`).toBeTruthy();
    }
  });

  it('every entry points at *.freegamestore.online (not freeappstore)', () => {
    for (const [id, record] of Object.entries(APPS)) {
      expect(record.subdomain, `subdomain for ${id}`).toMatch(/freegamestore\.online$/);
    }
  });
});
