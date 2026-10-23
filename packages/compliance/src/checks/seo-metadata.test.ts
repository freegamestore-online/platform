import { describe, expect, it } from 'vitest';
import { mapFileSource } from '../lib/file-source.js';
import { checkSeoMetadata } from './seo-metadata.js';

describe('SEO metadata defaults', () => {
  it('warns rather than blocks a game relying on the shared host', async () => {
    const result = await checkSeoMetadata(
      mapFileSource(new Map([['web/index.html', '<head><title>Game</title></head>']])),
    );
    expect(result.status).toBe('warn');
    expect(result.detail).toContain('shared host');
  });
  it('passes complete defaults and ignores commented-out tags', async () => {
    const html =
      '<link rel="canonical" href="https://game.freegamestore.online/">' +
      ['description', 'twitter:card', 'twitter:title', 'twitter:description']
        .map((name) => `<meta name="${name}" content="game">`)
        .join('') +
      ['og:title', 'og:description', 'og:url', 'og:type', 'og:site_name']
        .map((name) => `<meta property="${name}" content="game">`)
        .join('');
    const check = (value: string) =>
      checkSeoMetadata(mapFileSource(new Map([['web/index.html', value]])));
    expect((await check(html)).status).toBe('pass');
    expect((await check(`<!-- ${html} -->`)).status).toBe('warn');
  });
});
