import { z } from 'zod';
import { readRegistryGames } from '../github.js';
import { fgsApi, getDeployStatus, withTimeout } from '../http.js';
import { errText, type RegistrationContext, txt } from './registration.js';

/**
 * The "Remixed from" line for game_info, or null when the registry records no
 * lineage. Remixes store an attribution object (#35); legacy entries store the
 * source id as a bare string. Anything else is treated as absent.
 */
export function forkLine(forkedFrom: unknown): string | null {
  if (typeof forkedFrom === 'string') {
    return forkedFrom.trim() ? `Remixed from: ${forkedFrom}` : null;
  }
  if (!forkedFrom || typeof forkedFrom !== 'object') return null;
  const f = forkedFrom as Record<string, unknown>;
  if (typeof f.id !== 'string' || !f.id) return null;
  const name = typeof f.name === 'string' && f.name.trim() ? f.name : f.id;
  const by = typeof f.creatorGithub === 'string' && f.creatorGithub ? ` by @${f.creatorGithub}` : '';
  const on = typeof f.forkedAt === 'string' && f.forkedAt ? `, forked ${f.forkedAt}` : '';
  return `Remixed from: ${name} (${f.id})${by}${on}`;
}

export function registerCatalogTools(ctx: RegistrationContext): void {
  // -- list_games --
  ctx.safeTool(
    'list_games',
    'List all published games on FreeGameStore (from the store registry). No auth needed.',
    {},
    async () => {
      const data = (await fgsApi(ctx.env.API_BASE, '/api/status')) as
        | Array<{ id: string; name: string; domain: string; org: string }>
        | { error: string }
        | null;
      // null is a real fgsApi return (204 / empty body); reading .error off it
      // would throw and resurface as the opaque wrapper this tool just fixed.
      if (data === null) return errText('No game data returned from /api/status (empty response)');
      if (!Array.isArray(data))
        return errText(`Error: ${(data as { error?: string }).error ?? 'unexpected response'}`);
      const games = data as Array<{ id: string; name: string; domain: string; org: string }>;
      if (games.length === 0) return txt('No games published yet.');
      const lines = games.map((g) => `- **${g.name}** (${g.id}) — https://${g.domain}`);
      return txt(`${games.length} game(s):\n\n${lines.join('\n')}`);
    },
  );

  // -- deploy_status --
  ctx.safeTool(
    'deploy_status',
    'Check the deploy status of a game (last 5 GitHub Actions runs). No auth needed for public repos.',
    { game_id: z.string().describe("Game ID (e.g. 'chess', 'tetris')") },
    async ({ game_id }) => {
      const runs = await getDeployStatus(ctx.env.GITHUB_ORG, game_id);
      if (!Array.isArray(runs)) return errText(`Error: ${(runs as { error: string }).error}`);
      if (runs.length === 0) return txt(`No workflow runs found for ${game_id}.`);
      const lines = runs.map(
        (r) =>
          `- ${r.status === 'success' ? 'OK' : r.status === 'failure' ? 'FAIL' : '...'} ${r.name} (${r.sha}) — ${r.updatedAt}\n  ${r.url}`,
      );
      return txt(`Deploy history for **${game_id}**:\n\n${lines.join('\n')}`);
    },
  );

  // -- game_info --
  ctx.safeTool(
    'game_info',
    'Get info about any game on FreeGameStore — live URL, repo, store listing.',
    { game_id: z.string().describe("Game ID (e.g. 'chess', 'tetris')") },
    async ({ game_id }) => {
      const domain = 'freegamestore.online';
      const org = ctx.env.GITHUB_ORG;
      const liveUrl = `https://${game_id}.${domain}`;
      const repoUrl = `https://github.com/${org}/${game_id}`;
      const listingUrl = `https://${domain}/games/${game_id}`;

      // Build status comes from the registry, NOT from probing the URL (#22).
      // Provisioning writes the repo, host route and registry entry BEFORE the
      // first build, and deploy.yml syncs the template scaffold to R2 — so the
      // host answers a genuine 200 for a game whose code has never compiled.
      // A HEAD probe cannot tell that apart from a shipped game, which is what
      // reported candy-shop and squishy-swap as "Live (200)" for 30+ minutes
      // while CI was red (2026-08-09).
      //
      // The probe is still worth running for a game the registry says HAS
      // shipped — that is the case where it carries real information (the host
      // is genuinely down) rather than fabricating liveness.
      const registry = await readRegistryGames(org, ctx.env.STORE_REPO, ctx.env.GITHUB_TOKEN);
      const entry =
        registry.status === 'available' ? registry.games.find((g) => g.id === game_id) : undefined;
      // Absent entry → unlisted; absent status → predates the field, so live.
      const buildStatus =
        registry.status === 'unavailable'
          ? 'unavailable'
          : !entry
            ? 'unlisted'
            : entry.status === 'pending' || entry.status === 'failed'
              ? entry.status
              : 'live';

      const fork = forkLine(entry?.forkedFrom);

      let status: string;
      if (buildStatus === 'unavailable') {
        status = 'Store registry is temporarily unavailable';
      } else if (buildStatus === 'unlisted') {
        status = 'Not listed in the store registry';
      } else if (buildStatus === 'pending') {
        status = 'Building — provisioned, but no successful build yet (not live)';
      } else if (buildStatus === 'failed') {
        status = 'Build failed — has never deployed successfully (not live)';
      } else {
        try {
          const check = await withTimeout((signal) => fetch(liveUrl, { method: 'HEAD', signal }));
          status = check.ok ? 'Live (200)' : `Down (${check.status})`;
        } catch {
          status = 'Unreachable';
        }
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: [
              `**${game_id}**`,
              `Status: ${status}`,
              `Live: ${liveUrl}`,
              `Repo: ${repoUrl}`,
              ...(fork ? [fork] : []),
              `Listing: ${listingUrl}`,
              `Deploy: push to main auto-deploys via GitHub Actions -> R2`,
            ].join('\n'),
          },
        ],
      };
    },
  );

  // -- game_quality --
  ctx.safeTool(
    'game_quality',
    'Get quality audit results for games (scores, load times, console errors). No auth needed.',
    { game_id: z.string().optional().describe('Game ID to filter (omit for all games)') },
    async ({ game_id }) => {
      const data = (await fgsApi(ctx.env.API_BASE, '/api/quality')) as
        | {
            timestamp: string;
            games: Array<{
              id: string;
              score: number;
              loadTimeMs: number;
              consoleErrors: string[];
            }>;
          }
        | { error: string }
        | null;
      if (!data || typeof data !== 'object') return txt('No quality audit data available yet.');
      if ('error' in data) return errText(`Error: ${(data as { error: string }).error}`);
      const qd = data as {
        timestamp: string;
        games: Array<{ id: string; score: number; loadTimeMs: number; consoleErrors: string[] }>;
      };
      if (!qd.games) return txt('No quality audit data available yet.');
      let games = qd.games ?? [];
      if (game_id) games = games.filter((g) => g.id === game_id);
      if (games.length === 0)
        return txt(game_id ? `No quality data for ${game_id}.` : 'No quality data available.');
      const lines = games.map((g) => {
        const errs = g.consoleErrors ?? [];
        const errors = errs.length > 0 ? ` | Errors: ${errs.join(', ')}` : '';
        return `- **${g.id}**: score ${g.score}/100, load ${g.loadTimeMs}ms${errors}`;
      });
      return txt(`Quality audit (${qd.timestamp}):\n\n${lines.join('\n')}`);
    },
  );

  // -- leaderboard: HIDDEN (issue #31) --
  // Not surfaced to users for now. The tool body and the workers/leaderboard
  // API behind it are intentionally left intact — uncomment to re-enable, and
  // add "leaderboard" back to server.json (safety.test.mjs holds the two in
  // sync). Line comments rather than a block comment on purpose: that test
  // discovers tools by scanning the raw source for the registration call, and
  // only a `//` between the paren and the quote stops it matching.
  // ctx.safeTool(
  // "leaderboard",
  // "Query the leaderboard for a game — top scores and recent scores.",
  // {
  // game_id: z.string().describe("Game ID"),
  // limit: z.number().optional().describe("Max entries (default 10)"),
  // },
  // async ({ game_id, limit }) => {
  // const n = limit ?? 10;
  // const r = await safeFetch("the leaderboard API", (signal) => fetch(
  // `${ctx.env.LEADERBOARD_BASE}/api/leaderboard/${game_id}?limit=${n}`,
  // { headers: { "User-Agent": "freegamestore-mcp" }, signal }
  // ));
  // if ("error" in r) return errText(r.error);
  // const res = r.res;
  // if (!res.ok) return errText(`Leaderboard API error: ${res.status}`);
  // // The worker returns rows keyed `player_name` (not `name`); keep `name`
  // // as a fallback so this doesn't render "**undefined**".
  // let data: { scores?: Array<{ player_name?: string; name?: string; score: number; created_at: string }> };
  // try {
  // data = (await res.json()) as typeof data;
  // } catch {
  // return errText(`Leaderboard API returned invalid JSON.`);
  // }
  // const scores = data.scores ?? [];
  // if (scores.length === 0) return txt(`No leaderboard entries for ${game_id}.`);
  // const lines = scores.map(
  // (s, i) => `${i + 1}. **${s.player_name ?? s.name ?? "Anonymous"}** — ${s.score} (${new Date(s.created_at).toLocaleDateString()})`
  // );
  // return txt(`Leaderboard for **${game_id}** (top ${scores.length}):\n\n${lines.join("\n")}`);
  // }
  // );

  // -- platform_guide --
  ctx.safeTool(
    'platform_guide',
    'Get the FreeGameStore platform guide for AI-assisted game development.',
    {},
    async () => {
      for (const path of ['/SKILLS.md', '/skills.md']) {
        const res = await withTimeout((signal) =>
          fetch(`https://freegamestore.online${path}`, { signal }),
        );
        if (res.ok) return txt(await res.text());
        await res.body?.cancel();
      }
      return errText('Failed to fetch SKILLS.md from freegamestore.online.');
    },
  );

  // -- sdk_reference --
  ctx.safeTool(
    'sdk_reference',
    'Quick reference for @freegamestore/games SDK — imports, features, and usage patterns for auth, leaderboard, sound, and UI components.',
    {
      feature: z
        .enum(['all', 'shell', 'auth', 'sound', 'ui'])
        .optional()
        .describe("Specific feature, or 'all'"),
    },
    async ({ feature }) => {
      const sections: Record<string, string> = {
        shell: `## GameShell + GameTopbar (required wrapper)
\`\`\`tsx
import { GameShell, GameTopbar, GameAuth } from '@freegamestore/games'

<GameShell topbar={
  <GameTopbar
title="My Game"
score={42}                           // shorthand for a single "Score" stat
stats={[                             // or pass custom stats array
  { label: "SCORE", value: score, accent: true },
  { label: "BEST", value: best },
]}
actions={<GameAuth />}               // right-side slot (sign-in button)
rules={<div>How to play...</div>}    // info button -> fullscreen overlay
onRestart={restart}                  // restart icon
onPlayPause={toggle} paused={isPaused} // play/pause for real-time games
  />
}>
  <YourGameBoard />
</GameShell>
\`\`\`
GameShell: fixed 100svh layout, SoundProvider context, overflow hidden. GameTopbar: brand-consistent bar (don't build your own).`,
        auth: `## Auth
\`\`\`tsx
import { GameAuth, useAuth } from '@freegamestore/games'

<GameAuth />  // drop-in sign-in / avatar button

const { user, loading, signIn, signOut } = useAuth()
// user: { id: string, name: string, avatar: string } | null
// signIn() redirects to auth.freegamestore.online (GitHub OAuth)
\`\`\``,
        sound: `## Sound
\`\`\`tsx
import { useSound, useGameSounds } from '@freegamestore/games'

// Mute state (controlled by topbar toggle):
const { muted, toggle } = useSound()

// Synthesized Web Audio effects (zero audio files, respect mute automatically):
const sounds = useGameSounds()
sounds.playMove()      // click/tap — piece moved, card flipped
sounds.playScore()     // positive ding — scored, matched
sounds.playError()     // negative buzz — wrong, hit obstacle
sounds.playDrop()      // thud — block landed
sounds.playClear()     // sweep — line cleared, combo
sounds.playLevelUp()   // ascending arpeggio — level up
sounds.playGameOver()  // descending tones — game over
sounds.playTick()      // countdown tick
\`\`\`
IMPORTANT: useGameSounds() must be called inside GameShell (needs SoundProvider context). Put game logic in a child component of GameShell.`,
        ui: `## UI Components
\`\`\`tsx
import {
  GameButton, GameConfirm, GameModal, GameOverScreen,
  GameTextSizeToggle, GameThemeToggle,
} from '@freegamestore/games'

<GameButton variant="primary" size="md" onClick={start}>Play</GameButton>
<GameButton variant="ghost" size="sm" onClick={skip}>Skip</GameButton>
<GameConfirm open={show} title="Restart?" message="Progress will be lost"
  onConfirm={restart} onCancel={close} variant="danger" />
<GameModal open={settingsOpen} onClose={close} title="Settings">...</GameModal>
<GameOverScreen score={score} highScore={best} onPlayAgain={restart} />
<GameTextSizeToggle />
<GameThemeToggle />
\`\`\`
Variants: primary | secondary | ghost | danger. Sizes: sm | md | lg.`,
      };

      const selected =
        feature === 'all' || !feature
          ? Object.values(sections).join('\n\n')
          : (sections[feature] ?? `Unknown feature: ${feature}`);

      return txt(`# @freegamestore/games SDK Reference\n\n${selected}`);
    },
  );
}
