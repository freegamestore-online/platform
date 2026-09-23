import { defineConfig } from 'vitest/config';

// Test config for the Cloudflare Pages Functions (functions/api/*). These run in
// Node (the security-critical helpers use only Web-standard APIs — crypto.subtle,
// atob, fetch, TextEncoder — all present in Node 22), separate from web/'s jsdom
// suite. Run with: pnpm test:functions
export default defineConfig({
  test: {
    environment: 'node',
    include: ['functions/**/*.test.ts'],
  },
});
