import { describe, expect, it } from 'vitest';
import { normalizeApiBase } from './config.js';

describe('normalizeApiBase', () => {
  it('leaves a clean URL alone', () => {
    expect(normalizeApiBase('https://api.freegamestore.online')).toBe(
      'https://api.freegamestore.online',
    );
  });

  it('strips a single trailing slash (regression: //health URLs)', () => {
    expect(normalizeApiBase('https://api.freegamestore.online/')).toBe(
      'https://api.freegamestore.online',
    );
  });

  it('strips multiple trailing slashes', () => {
    expect(normalizeApiBase('https://api.freegamestore.online////')).toBe(
      'https://api.freegamestore.online',
    );
  });

  it('preserves path segments and only strips the rightmost slashes', () => {
    expect(normalizeApiBase('https://api.example.com/v1/')).toBe('https://api.example.com/v1');
    expect(normalizeApiBase('https://api.example.com/v1//')).toBe('https://api.example.com/v1');
  });

  it('handles localhost dev URLs', () => {
    expect(normalizeApiBase('http://localhost:8787/')).toBe('http://localhost:8787');
    expect(normalizeApiBase('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787');
  });
});
