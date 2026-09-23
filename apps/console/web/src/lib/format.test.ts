import { describe, expect, it } from 'vitest';
import { decodeIcon, formatDate, formatRelative } from './format';

describe('decodeIcon', () => {
  it('decodes a decimal HTML entity to its emoji', () => {
    expect(decodeIcon('&#128133;')).toBe('💅');
  });
  it('decodes a hex HTML entity', () => {
    expect(decodeIcon('&#x1F485;')).toBe('💅');
  });
  it('returns empty for empty input', () => {
    expect(decodeIcon('')).toBe('');
  });
  it('leaves an already-decoded emoji unchanged', () => {
    expect(decodeIcon('💅')).toBe('💅');
  });
  it('drops an invalid (zero) code point instead of throwing', () => {
    expect(decodeIcon('&#0;')).toBe('');
  });
});

describe('formatDate', () => {
  it("returns '' for empty or invalid input", () => {
    expect(formatDate('')).toBe('');
    expect(formatDate('not-a-date')).toBe('');
  });
  it('formats a valid ISO date', () => {
    const s = formatDate('2026-06-30T12:00:00Z');
    expect(s).toMatch(/2026/);
    expect(s).toMatch(/Jun|Jul/); // day can shift across the local tz boundary
  });
});

describe('formatRelative', () => {
  it("returns '' for empty or invalid input", () => {
    expect(formatRelative('')).toBe('');
    expect(formatRelative('nope')).toBe('');
  });
  it("says 'just now' under a minute", () => {
    expect(formatRelative(new Date(Date.now() - 5_000).toISOString())).toBe('just now');
  });
  it('reports minutes', () => {
    expect(formatRelative(new Date(Date.now() - 5 * 60_000).toISOString())).toBe('5m ago');
  });
  it('reports hours', () => {
    expect(formatRelative(new Date(Date.now() - 3 * 3_600_000).toISOString())).toBe('3h ago');
  });
  it('reports days', () => {
    expect(formatRelative(new Date(Date.now() - 4 * 86_400_000).toISOString())).toBe('4d ago');
  });
  it('falls back to an absolute date past ~30 days', () => {
    expect(formatRelative(new Date(Date.now() - 60 * 86_400_000).toISOString())).toMatch(/20\d\d/);
  });
});
