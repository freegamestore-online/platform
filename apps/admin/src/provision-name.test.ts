import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  escapeJsString,
  escapeJsx,
  handlePublish,
  nameError,
  substituteTemplatePlaceholders,
} from './publish';

// #448: the provision name is written into App.tsx, Shell.tsx, vite.config.ts and
// CLAUDE.md. It is bounded like PATCH, and escaped for the context it lands in.

afterEach(() => vi.restoreAllMocks());

describe('nameError', () => {
  it('accepts an ordinary name, including unicode, quotes and punctuation', () => {
    for (const ok of ['Pong', 'Café Run', 'Bob\'s "Big" Game', 'a'.repeat(60), '  padded  ']) {
      expect(nameError(ok), ok).toBeNull();
    }
  });
  it('refuses a name over 60 characters (after trimming)', () => {
    expect(nameError('a'.repeat(61))).toMatch(/60 characters/);
    expect(nameError(` ${'a'.repeat(60)} `)).toBeNull();
  });
  it('refuses control characters and line separators', () => {
    for (const bad of ['a\nb', 'a\rb', 'a\u0000b', 'a\u001bb', 'a b', 'a\u007fb']) {
      expect(nameError(bad), JSON.stringify(bad)).toMatch(/control characters/);
    }
  });
});

describe('escaping', () => {
  it('escapeJsx makes text safe for JSX text and quoted attributes', () => {
    const out = escapeJsx("\"><script>{alert(1)}</script> & 'x'");
    expect(out).not.toMatch(/[<>"'{}]/);
    expect(out).toContain('&amp;');
  });
  it('escapeJsString makes text safe inside either kind of JS string literal', () => {
    const out = escapeJsString('a"b\'c\\d ');
    expect(() => new Function(`return "${out}"`)()).not.toThrow();
    expect(() => new Function(`return '${out}'`)()).not.toThrow();
    expect(new Function(`return "${out}"`)()).toBe('a"b\'c\\d ');
    expect(new Function(`return '${out}'`)()).toBe('a"b\'c\\d ');
  });
});

describe('provisioning', () => {
  it('rejects an over-long name before touching GitHub', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const res = await handlePublish(
      { name: 'x'.repeat(61) } as never,
      { GITHUB_TOKEN: 't' } as never,
    );
    expect(res.success).toBe(false);
    expect(res.steps[0]).toMatchObject({ name: 'Validation', status: 'fail' });
    expect(res.steps[0]!.detail).toMatch(/60 characters/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a name with a newline before touching GitHub', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const res = await handlePublish(
      { name: 'Game\n# injected' } as never,
      { GITHUB_TOKEN: 't' } as never,
    );
    expect(res.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('writes the name into each file escaped for that file', async () => {
    const hostile = `Evil" /> {process.exit()} <img onerror='x'> \\`;
    const templates: Record<string, string> = {
      'web/src/App.tsx': '<GameTopbar title="APPNAME" />',
      'web/src/components/Shell.tsx': '<h1>APPNAME</h1>',
      'web/vite.config.ts': 'name: "APPNAME", short_name: \'APPNAME\'',
      'CLAUDE.md': '# APPNAME',
    };
    const blobs: Record<string, string> = {};
    let blobIndex = 0;
    const blobPath: Record<string, string> = {};
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/git/ref/heads/main')) return Response.json({ object: { sha: 'head' } });
      if (url.includes('/git/commits/head')) return Response.json({ tree: { sha: 'base' } });
      const content = /\/contents\/(.+)$/.exec(url)?.[1];
      if (method === 'GET' && content) {
        return templates[content]
          ? Response.json({ content: btoa(templates[content]!) })
          : new Response('{}', { status: 404 });
      }
      if (method === 'POST' && url.endsWith('/git/blobs')) {
        const id = `blob${blobIndex++}`;
        blobs[id] = JSON.parse(String(init?.body)).content;
        return Response.json({ sha: id }, { status: 201 });
      }
      if (method === 'POST' && url.endsWith('/git/trees')) {
        for (const item of JSON.parse(String(init?.body)).tree) blobPath[item.path] = item.sha;
        return Response.json({ sha: 'tree' }, { status: 201 });
      }
      if (method === 'POST' && url.endsWith('/git/commits')) {
        return Response.json(
          { sha: 'commit', message: JSON.parse(String(init?.body)).message },
          { status: 201 },
        );
      }
      if (method === 'PATCH') return Response.json({ ref: 'refs/heads/main' });
      return Response.json({});
    });
    const step = await substituteTemplatePlaceholders(
      { GITHUB_TOKEN: 't' } as never,
      'org',
      'evil',
      hostile,
    );
    expect(step.status).toBe('ok');
    const written = (path: string) => blobs[blobPath[path]!]!;

    // JSX: no raw quote, brace or angle bracket survives from the name.
    const app = written('web/src/App.tsx');
    expect(app).toBe(`<GameTopbar title="${escapeJsx(hostile)}" />`);
    expect(app.slice('<GameTopbar title="'.length, -'" />'.length)).not.toMatch(/["{}<>]/);
    expect(written('web/src/components/Shell.tsx')).not.toContain('<img');
    // JS: both string literals still parse and hold the exact name.
    const vite = written('web/vite.config.ts');
    expect(() => new Function(`return ({${vite}})`)()).not.toThrow();
    expect(new Function(`return ({${vite}})`)()).toEqual({ name: hostile, short_name: hostile });
  });
});
