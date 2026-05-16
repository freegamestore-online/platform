import { describe, it, expect } from 'vitest';
import { repoSlug } from './list.js';

describe('repoSlug', () => {
  it('parses owner/name from a github HTTPS URL', () => {
    expect(repoSlug('https://github.com/foo/bar')).toBe('foo/bar');
  });
  it('strips a trailing .git', () => {
    expect(repoSlug('https://github.com/foo/bar.git')).toBe('foo/bar');
  });
  it('strips a trailing slash', () => {
    expect(repoSlug('https://github.com/foo/bar/')).toBe('foo/bar');
  });
  it('keeps dots in the repo name (regression: previously stopped at the dot)', () => {
    expect(repoSlug('https://github.com/nodejs/node.js')).toBe('nodejs/node.js');
    expect(repoSlug('https://github.com/nodejs/node.js.git')).toBe('nodejs/node.js');
  });
  it('parses SSH-style URLs too', () => {
    expect(repoSlug('git@github.com:foo/bar.git')).toBe('foo/bar');
  });
  it('returns empty string for non-github URLs', () => {
    expect(repoSlug('https://gitlab.com/foo/bar')).toBe('');
    expect(repoSlug('')).toBe('');
  });
});
