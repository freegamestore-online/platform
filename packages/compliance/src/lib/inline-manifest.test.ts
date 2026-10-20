import { describe, expect, it } from 'vitest';
import { extractInlineManifest } from './inline-manifest';

// Pins the bracket matching that #362 factored into one helper: nested
// objects, brackets inside quoted values, escapes, and unterminated input.

const config = (manifest: string) => `import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({
  plugins: [VitePWA({ registerType: 'autoUpdate', manifest: ${manifest} })],
});
`;

describe('extractInlineManifest', () => {
  it('reads fields and the icons array through nested objects', () => {
    const m = extractInlineManifest(
      config(`{
        name: 'Chess',
        short_name: "Chess",
        display: 'standalone',
        min_viewport_width: 320,
        icons: [
          { src: '/icon-192.png', sizes: '192x192' },
          { src: '/icon-512.png', sizes: '512x512', purpose: 'maskable' },
        ],
      }`),
    );
    expect(m).toMatchObject({
      name: 'Chess',
      short_name: 'Chess',
      display: 'standalone',
      min_viewport_width: 320,
      icons: true,
    });
    expect(m?.iconsRaw).toMatch(/^\[[\s\S]*maskable[\s\S]*\]$/);
  });

  it('ignores closing brackets inside quoted values', () => {
    const m = extractInlineManifest(
      config(`{
        name: 'Brace } and bracket ] game',
        description: \`multi } line ]\`,
        icons: [{ src: '/a].png', note: "x}" }],
        start_url: '/',
      }`),
    );
    expect(m?.start_url).toBe('/');
    expect(m?.iconsRaw).toBe(`[{ src: '/a].png', note: "x}" }]`);
  });

  it('skips an escaped quote inside a string', () => {
    const m = extractInlineManifest(config(`{ name: 'it\\'s }', start_url: '/play' }`));
    expect(m?.start_url).toBe('/play');
  });

  it('returns null for an unterminated manifest object', () => {
    expect(extractInlineManifest(`VitePWA({ manifest: { name: 'x', icons: [`)).toBeNull();
  });

  it('leaves iconsRaw undefined when the icons array never closes', () => {
    const m = extractInlineManifest(config(`{ name: 'x', icons: '[' }`));
    expect(m?.iconsRaw).toBeUndefined();
  });

  it('returns null when there is no manifest', () => {
    expect(extractInlineManifest('export default {}')).toBeNull();
  });
});
