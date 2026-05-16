import { describe, it, expect } from 'vitest';
import { formatRelative } from './history.js';

describe('formatRelative', () => {
  const now = new Date('2026-05-06T12:00:00Z');

  it('seconds', () => {
    expect(formatRelative('2026-05-06T11:59:30Z', now)).toBe('30s ago');
  });
  it('minutes', () => {
    expect(formatRelative('2026-05-06T11:55:00Z', now)).toBe('5 min ago');
  });
  it('hours', () => {
    expect(formatRelative('2026-05-06T08:00:00Z', now)).toBe('4h ago');
  });
  it('yesterday singular', () => {
    expect(formatRelative('2026-05-05T12:00:00Z', now)).toBe('yesterday');
  });
  it('days', () => {
    expect(formatRelative('2026-05-01T12:00:00Z', now)).toBe('5 days ago');
  });
  it('months', () => {
    expect(formatRelative('2026-02-06T12:00:00Z', now)).toBe('3 months ago');
  });
  it('years', () => {
    expect(formatRelative('2024-05-06T12:00:00Z', now)).toBe('2 years ago');
  });
  it('returns the input when not a valid date', () => {
    expect(formatRelative('not-a-date', now)).toBe('not-a-date');
  });
});
