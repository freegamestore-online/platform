import { describe, it, expect } from 'vitest';
import { isValidAppId, assertValidAppId } from './app-id.js';

describe('isValidAppId', () => {
  it('accepts typical short app ids', () => {
    expect(isValidAppId('chess')).toBe(true);
    expect(isValidAppId('calculator')).toBe(true);
    expect(isValidAppId('todo')).toBe(true);
  });

  it('accepts ids with digits and hyphens', () => {
    expect(isValidAppId('app2')).toBe(true);
    expect(isValidAppId('my-app')).toBe(true);
    expect(isValidAppId('a1-b2-c3')).toBe(true);
  });

  it('rejects single-char ids (must be 2-31 chars total)', () => {
    expect(isValidAppId('a')).toBe(false);
  });

  it('accepts 31-char ids and rejects 32+', () => {
    expect(isValidAppId('a' + 'b'.repeat(30))).toBe(true); // 31 total
    expect(isValidAppId('a' + 'b'.repeat(31))).toBe(false); // 32 total
  });

  it('rejects ids that start with a digit, hyphen, or uppercase', () => {
    expect(isValidAppId('1app')).toBe(false);
    expect(isValidAppId('-app')).toBe(false);
    expect(isValidAppId('App')).toBe(false);
  });

  it('rejects ids with disallowed characters', () => {
    expect(isValidAppId('my_app')).toBe(false); // underscore
    expect(isValidAppId('my.app')).toBe(false); // dot
    expect(isValidAppId('my app')).toBe(false); // space
    expect(isValidAppId('my/app')).toBe(false); // slash
    expect(isValidAppId('myapp!')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidAppId('')).toBe(false);
  });
});

describe('assertValidAppId', () => {
  it('throws with a clear message on invalid input', () => {
    expect(() => assertValidAppId('Bad')).toThrow(/lowercase/);
  });

  it('does not throw on valid input', () => {
    expect(() => assertValidAppId('good-app')).not.toThrow();
  });
});
