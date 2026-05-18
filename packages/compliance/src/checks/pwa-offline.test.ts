import { describe, expect, it } from 'vitest';
import { mapFileSource } from '../lib/file-source.js';
import { checkPwaOffline } from './pwa-offline.js';

const VITE_CONFIG = 'web/vite.config.ts';
const INDEX_HTML = 'web/index.html';

// Mirror of bowling's known-good config — the reference everything else should look like.
const GOOD_WORKBOX = `
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig({
  plugins: [
    VitePWA({
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,ico,woff2,wasm,json}"],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        runtimeCaching: [
          { urlPattern: /^https:\\/\\/fonts\\.googleapis\\.com\\/.*/i, handler: "CacheFirst" },
          { urlPattern: /^https:\\/\\/fonts\\.gstatic\\.com\\/.*/i, handler: "CacheFirst" },
        ],
      },
    }),
  ],
});
`;

const HTML_WITH_FONTS = `<html><head>
  <link rel="manifest" href="/manifest.webmanifest" />
  <link href="https://fonts.googleapis.com/css2?family=Manrope" rel="stylesheet" />
</head></html>`;

const HTML_NO_FONTS = `<html><head>
  <link rel="manifest" href="/manifest.webmanifest" />
</head></html>`;

describe('checkPwaOffline', () => {
  it('passes for a config that mirrors bowling', async () => {
    const r = await checkPwaOffline(
      mapFileSource(
        new Map([
          [VITE_CONFIG, GOOD_WORKBOX],
          [INDEX_HTML, HTML_WITH_FONTS],
        ]),
      ),
    );
    expect(r.status).toBe('pass');
  });

  it('passes when there is no vite config at all', async () => {
    const r = await checkPwaOffline(mapFileSource(new Map()));
    expect(r.status).toBe('pass');
    expect(r.detail).toMatch(/not a Vite/);
  });

  it('fails when index.html links a manifest but VitePWA is missing', async () => {
    const r = await checkPwaOffline(
      mapFileSource(
        new Map([
          [VITE_CONFIG, 'export default {};'],
          [INDEX_HTML, HTML_NO_FONTS],
        ]),
      ),
    );
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/no VitePWA|no service worker/i);
  });

  it('passes when there is no VitePWA AND no manifest link (plain site)', async () => {
    const r = await checkPwaOffline(
      mapFileSource(
        new Map([
          [VITE_CONFIG, 'export default {};'],
          [INDEX_HTML, '<html><head><title>x</title></head></html>'],
        ]),
      ),
    );
    expect(r.status).toBe('pass');
    expect(r.detail).toMatch(/not a PWA/);
  });

  it('warns when maximumFileSizeToCacheInBytes is missing', async () => {
    const config = `
      import { VitePWA } from "vite-plugin-pwa";
      export default { plugins: [VitePWA({
        workbox: {
          globPatterns: ["**/*.{js,css,html,png,svg,ico,woff2,wasm,json}"],
          runtimeCaching: [
            { urlPattern: /^https:\\/\\/fonts\\.googleapis\\.com\\/.*/i },
            { urlPattern: /^https:\\/\\/fonts\\.gstatic\\.com\\/.*/i },
          ],
        },
      })] };`;
    const r = await checkPwaOffline(
      mapFileSource(
        new Map([
          [VITE_CONFIG, config],
          [INDEX_HTML, HTML_WITH_FONTS],
        ]),
      ),
    );
    expect(r.status).toBe('warn');
    expect(r.detail).toMatch(/maximumFileSizeToCacheInBytes/);
  });

  it('warns when Google Fonts are loaded but not in runtimeCaching', async () => {
    const config = `
      import { VitePWA } from "vite-plugin-pwa";
      export default { plugins: [VitePWA({
        workbox: {
          globPatterns: ["**/*.{js,css,html,png,svg,ico,woff2}"],
          maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        },
      })] };`;
    const r = await checkPwaOffline(
      mapFileSource(
        new Map([
          [VITE_CONFIG, config],
          [INDEX_HTML, HTML_WITH_FONTS],
        ]),
      ),
    );
    expect(r.status).toBe('warn');
    expect(r.detail).toMatch(/Google Fonts/);
  });

  it('passes when Google Fonts not used and runtimeCaching omitted', async () => {
    const config = `
      import { VitePWA } from "vite-plugin-pwa";
      export default { plugins: [VitePWA({
        workbox: {
          globPatterns: ["**/*.{js,css,html,png,svg,ico,woff2}"],
          maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        },
      })] };`;
    const r = await checkPwaOffline(
      mapFileSource(
        new Map([
          [VITE_CONFIG, config],
          [INDEX_HTML, HTML_NO_FONTS],
        ]),
      ),
    );
    expect(r.status).toBe('pass');
  });

  it('warns when public/ has assets in extensions not in globPatterns (e.g. wasm)', async () => {
    const config = `
      import { VitePWA } from "vite-plugin-pwa";
      export default { plugins: [VitePWA({
        workbox: {
          globPatterns: ["**/*.{js,css,html,png,svg,ico,woff2}"],
          maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        },
      })] };`;
    const r = await checkPwaOffline(
      mapFileSource(
        new Map([
          [VITE_CONFIG, config],
          [INDEX_HTML, HTML_NO_FONTS],
          ['web/public/stockfish/stockfish.wasm', '\0\0'],
          ['web/public/stockfish/stockfish.js', '// engine'],
          ['web/public/icon-192.png', 'png-bytes'],
        ]),
      ),
    );
    expect(r.status).toBe('warn');
    expect(r.detail).toMatch(/wasm/);
  });
});
