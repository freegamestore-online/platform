import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { adminNavigationFallbackDenylist } from './src/navigationFallback.ts';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // These routes are handled by the admin worker. Serving the cached SPA
        // for an OAuth handoff prevents the worker from exchanging the token
        // and leaves the user signed out.
        navigateFallbackDenylist: adminNavigationFallbackDenylist,
      },
      manifest: {
        name: 'FreeGameStore Admin',
        short_name: 'FGS Admin',
        description: 'FreeGameStore platform admin console',
        theme_color: '#10b981',
        background_color: '#0d0f0e',
        display: 'standalone',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  build: {
    outDir: '../public',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
});
