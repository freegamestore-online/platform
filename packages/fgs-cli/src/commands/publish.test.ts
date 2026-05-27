import { describe, expect, it } from 'vitest';
import {
  buildPromptList,
  buildSubmissionUrl,
  parseGitHubRepo,
  resolveCategory,
  resolveFromFlags,
  resolveType,
} from './publish.js';

describe('parseGitHubRepo', () => {
  it('parses HTTPS clone URLs', () => {
    expect(parseGitHubRepo('https://github.com/foo/bar')).toBe('foo/bar');
    expect(parseGitHubRepo('https://github.com/foo/bar.git')).toBe('foo/bar');
    expect(parseGitHubRepo('https://github.com/foo/bar/')).toBe('foo/bar');
    expect(parseGitHubRepo('https://github.com/foo/bar.git/')).toBe('foo/bar');
  });

  it('parses SSH clone URLs', () => {
    expect(parseGitHubRepo('git@github.com:foo/bar.git')).toBe('foo/bar');
    expect(parseGitHubRepo('git@github.com:foo/bar')).toBe('foo/bar');
  });

  it('allows dots in repo names (e.g. node.js, foo.config)', () => {
    expect(parseGitHubRepo('https://github.com/nodejs/node.js')).toBe('nodejs/node.js');
    expect(parseGitHubRepo('git@github.com:nodejs/node.js.git')).toBe('nodejs/node.js');
  });

  it('allows hyphens, underscores, and digits', () => {
    expect(parseGitHubRepo('https://github.com/foo-bar/baz_qux-2')).toBe('foo-bar/baz_qux-2');
  });

  it('returns null for non-GitHub URLs', () => {
    expect(parseGitHubRepo('https://gitlab.com/foo/bar')).toBeNull();
    expect(parseGitHubRepo('https://example.com/repo')).toBeNull();
    expect(parseGitHubRepo('not a url')).toBeNull();
    expect(parseGitHubRepo('')).toBeNull();
  });
});

describe('buildSubmissionUrl', () => {
  const baseInput = {
    name: 'my-app',
    category: 'Productivity' as const,
    type: 'Standalone (no backend, localStorage only)' as const,
    oneliner: 'A quick way to track tasks',
    description: 'Detailed description here.',
    repo: null,
    demo: null,
  };

  it('builds a github.com submission URL with the right template', () => {
    const url = new URL(buildSubmissionUrl(baseInput));
    expect(url.host).toBe('github.com');
    expect(url.pathname).toBe('/freegamestore-online/submissions/issues/new');
    expect(url.searchParams.get('template')).toBe('app-submission.yml');
  });

  it('prefills every required template field', () => {
    const url = new URL(buildSubmissionUrl(baseInput));
    expect(url.searchParams.get('name')).toBe('my-app');
    expect(url.searchParams.get('category')).toBe('Productivity');
    expect(url.searchParams.get('type')).toBe(baseInput.type);
    expect(url.searchParams.get('oneliner')).toBe('A quick way to track tasks');
    expect(url.searchParams.get('description')).toBe('Detailed description here.');
    expect(url.searchParams.get('title')).toBe('[Submission] my-app');
  });

  it('includes repo when present, omits when null', () => {
    const withRepo = new URL(buildSubmissionUrl({ ...baseInput, repo: 'https://github.com/me/x' }));
    expect(withRepo.searchParams.get('repo')).toBe('https://github.com/me/x');
    const without = new URL(buildSubmissionUrl(baseInput));
    expect(without.searchParams.has('repo')).toBe(false);
  });

  it('includes demo when present, omits when null', () => {
    const withDemo = new URL(buildSubmissionUrl({ ...baseInput, demo: 'https://demo.example' }));
    expect(withDemo.searchParams.get('demo')).toBe('https://demo.example');
    const without = new URL(buildSubmissionUrl(baseInput));
    expect(without.searchParams.has('demo')).toBe(false);
  });

  it('properly URL-encodes special characters in description', () => {
    const url = new URL(
      buildSubmissionUrl({
        ...baseInput,
        description: 'A "quoted" thing & more (with parens)',
      }),
    );
    expect(url.searchParams.get('description')).toBe('A "quoted" thing & more (with parens)');
  });
});

describe('resolveCategory', () => {
  it('matches exact label', () => {
    expect(resolveCategory('Arcade')).toBe('Arcade');
  });
  it('matches case-insensitive', () => {
    expect(resolveCategory('arcade')).toBe('Arcade');
    expect(resolveCategory('STRATEGY')).toBe('Strategy');
    expect(resolveCategory('  Brain Training  ')).toBe('Brain Training');
  });
  it('matches "other" short form', () => {
    expect(resolveCategory('other')).toBe('Other (specify in description)');
  });
  it('returns null for unknown', () => {
    expect(resolveCategory('nope')).toBeNull();
    expect(resolveCategory('')).toBeNull();
  });
});

describe('resolveType', () => {
  it('matches short forms', () => {
    expect(resolveType('standalone')).toBe('Standalone (no backend, localStorage only)');
    expect(resolveType('connected')).toBe(
      'Connected (Firebase/Supabase backend, shared with Pro version)',
    );
  });
  it('matches case-insensitive full label', () => {
    expect(resolveType('STANDALONE')).toBe('Standalone (no backend, localStorage only)');
  });
  it('returns null for unknown', () => {
    expect(resolveType('something')).toBeNull();
  });
});

describe('resolveFromFlags', () => {
  it('returns empty values when no flags supplied', () => {
    const r = resolveFromFlags({});
    expect(r.values).toEqual({});
    expect(r.errors).toEqual([]);
  });
  it('resolves valid combinations', () => {
    const r = resolveFromFlags({
      name: 'my-app',
      category: 'arcade',
      type: 'standalone',
      oneliner: 'Does a thing',
      demo: 'https://demo.example',
    });
    expect(r.errors).toEqual([]);
    expect(r.values.name).toBe('my-app');
    expect(r.values.category).toBe('Arcade');
    expect(r.values.type).toBe('Standalone (no backend, localStorage only)');
    expect(r.values.oneliner).toBe('Does a thing');
    expect(r.values.demo).toBe('https://demo.example');
  });
  it('treats blank --demo as null', () => {
    const r = resolveFromFlags({ demo: '   ' });
    expect(r.values.demo).toBeNull();
  });
  it('rejects invalid app id', () => {
    const r = resolveFromFlags({ name: 'BadName' });
    expect(r.errors[0]).toMatch(/--name/);
    expect(r.values.name).toBeUndefined();
  });
  it('rejects unknown category and type', () => {
    const r = resolveFromFlags({ category: 'nope', type: 'foo' });
    expect(r.errors).toHaveLength(2);
  });
  it('rejects empty oneliner', () => {
    const r = resolveFromFlags({ oneliner: '   ' });
    expect(r.errors[0]).toMatch(/oneliner/);
  });
});

describe('buildPromptList', () => {
  const defaults = { appName: null, description: null };
  it('returns all 5 prompts when nothing resolved', () => {
    expect(buildPromptList({}, defaults).map((p) => p.name)).toEqual([
      'name',
      'category',
      'type',
      'oneliner',
      'demo',
    ]);
  });
  it('skips a prompt when its value is already resolved', () => {
    const list = buildPromptList(
      { name: 'my-app', category: 'Utilities', type: 'Standalone (no backend, localStorage only)' },
      defaults,
    );
    expect(list.map((p) => p.name)).toEqual(['oneliner', 'demo']);
  });
  it('returns empty list when everything resolved', () => {
    expect(
      buildPromptList(
        {
          name: 'x',
          category: 'Utilities',
          type: 'Standalone (no backend, localStorage only)',
          oneliner: 'y',
          demo: null,
        },
        defaults,
      ),
    ).toEqual([]);
  });
});
