import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// Output goes into the storefront's dist/docs so a single
// `wrangler pages deploy dist` ships both the storefront and the docs.
export default defineConfig({
  site: 'https://freegamestore.online',
  base: '/docs',
  outDir: '../dist/docs',
  trailingSlash: 'ignore',
  integrations: [
    starlight({
      title: 'FreeGameStore SDK',
      description: 'How to build, ship, and maintain a free game on freegamestore.online.',
      social: {
        github: 'https://github.com/freegamestore-online',
      },
      editLink: {
        baseUrl: 'https://github.com/freegamestore-online/freegamestore/edit/main/docs/',
      },
      customCss: ['./src/styles/custom.css'],
      sidebar: [
        {
          label: 'Start here',
          items: [
            { label: 'What is FreeGameStore?', slug: 'start/overview' },
            { label: 'Developer guidelines', slug: 'guidelines' },
            { label: 'Build your first game', slug: 'start/first-game' },
            { label: 'Publish to the storefront', slug: 'start/publishing' },
          ],
        },
        {
          label: 'SDK reference',
          items: [
            { label: 'Overview', slug: 'sdk/overview' },
            { label: 'GameShell', slug: 'sdk/game-shell' },
            { label: 'GameTopbar', slug: 'sdk/game-topbar' },
            { label: 'GameButton', slug: 'sdk/game-button' },
            { label: 'GameAuth', slug: 'sdk/game-auth' },
            { label: 'Leaderboard', slug: 'sdk/leaderboard' },
            { label: 'useAuth', slug: 'sdk/use-auth' },
            { label: 'useLeaderboard', slug: 'sdk/use-leaderboard' },
            { label: 'useSound', slug: 'sdk/use-sound' },
            { label: 'useGameSounds', slug: 'sdk/use-game-sounds' },
          ],
        },
        {
          label: 'How-to',
          items: [
            { label: 'Add sound to a game', slug: 'how-to/audio' },
            { label: 'Add a leaderboard', slug: 'how-to/leaderboard' },
            { label: 'Custom audio that respects mute', slug: 'how-to/custom-audio' },
            { label: 'Pause + game-over flow', slug: 'how-to/pause-game-over' },
          ],
        },
        {
          label: 'Compliance',
          items: [
            { label: 'Why we audit', slug: 'compliance/why' },
            { label: 'All checks', slug: 'compliance/checks' },
            { label: 'CLI: fgs check', slug: 'compliance/cli' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Brand tokens', slug: 'reference/brand-tokens' },
            { label: 'Required dependencies', slug: 'reference/dependencies' },
            { label: 'PWA + offline rules', slug: 'reference/pwa' },
          ],
        },
      ],
    }),
  ],
});
