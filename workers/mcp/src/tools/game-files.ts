import { z } from 'zod';
import {
  listRepoFiles,
  pushFiles,
  type RepoFile,
  readRegistryGames,
  readRepoFile,
  textToB64,
  validateGameId,
} from '../github.js';
import { fgsPost } from '../http.js';
import { audit, dryRun, requireWritable } from '../safety.js';
import { errText, type RegistrationContext, txt } from './registration.js';

/** Why `game_id` must not be read with the org token, or null if it may.
 *  list_files/read_file call GitHub with the ORG token, which can read every
 *  repo in the org — including private platform repos such as `platform`. So a
 *  read is only allowed for a well-formed id that is a game in the store
 *  registry; anything else is refused before any request to that repo (#70). */
async function readableGameError(ctx: RegistrationContext, game_id: string) {
  if (!validateGameId(game_id)) return errText(`"${game_id}" is not a valid game id.`);
  const registry = await readRegistryGames(
    ctx.env.GITHUB_ORG,
    ctx.env.STORE_REPO,
    ctx.env.GITHUB_TOKEN,
  );
  if (registry.status === 'unavailable') {
    return errText(
      `Couldn't verify "${game_id}" — the store registry is unavailable (${registry.detail}). Try again shortly.`,
    );
  }
  if (registry.status === 'missing' || !registry.games.some((g) => g.id === game_id)) {
    return errText(`"${game_id}" is not a game on FreeGameStore.`);
  }
  return null;
}

export function registerGameFilesTools(ctx: RegistrationContext): void {
  // -- create_game (provision + scaffold + go live) --
  ctx.safeTool(
    'create_game',
    'Create AND publish a brand-new game on FreeGameStore, end to end. Provisions the GitHub repo + R2 hosting + store listing, scaffolds the chosen template, and pushes it so the game deploys live at <game_id>.freegamestore.online (~1-2 min). Then use read_file/update_files to build it out. Requires authentication.',
    {
      game_id: z
        .string()
        .describe(
          'Game slug: lowercase letters/numbers/hyphens. Becomes <game_id>.freegamestore.online',
        ),
      name: z.string().describe("Display name (e.g. 'Chess', 'Space Invaders')"),
      category: z
        .string()
        .describe(
          'puzzle, arcade, strategy, card, board, trivia, racing, sports, action, simulation, or educational',
        ),
      description: z.string().optional().describe('Short description'),
      template: z
        .enum([
          'kaplay',
          'phaser',
          '3d',
          'pixi',
          'babylon',
          'excalibur',
          'littlejs',
          'canvas',
          'grid',
          'cards',
        ])
        .optional()
        .describe(
          "Engine/template to build on (default: canvas). Engines: 'kaplay' = beginner-friendly 2D arcade engine; 'phaser' = production 2D engine (scenes, arcade physics); '3d' = Three.js + react-three-fiber; 'pixi' = Pixi.js v8 WebGL 2D (particles, sprites); 'babylon' = Babylon.js 3D engine; 'excalibur' = TypeScript-native actor-based 2D; 'littlejs' = tiny all-in-one arcade (particles + procedural sound built in). Starters: 'canvas' = raw HTML5 canvas 2D; 'grid' = CSS-grid puzzle/board; 'cards' = DOM card game.",
        ),
      dry_run: z
        .boolean()
        .optional()
        .describe(
          'Preview only: validate and report what would be provisioned without creating the repo, hosting, or listing.',
        ),
    },
    async ({ game_id, name, category, description, template, dry_run = false }) => {
      const token = ctx.session.token;
      if (!token)
        return errText('Not authenticated. Connect with a FGS session token to create games.');
      if (!ctx.env.GITHUB_TOKEN)
        return errText('Write tools are disabled (server missing GITHUB_TOKEN).');
      const roBlock = await requireWritable(ctx.safetyCtx, 'create_game', { game_id, template });
      if (roBlock) return roBlock;

      const tmpl = template ?? 'canvas';

      if (dry_run) {
        return dryRun(
          ctx.safetyCtx,
          'create_game',
          'provision',
          { game_id, name, category, template: tmpl },
          {
            game_id,
            template: tmpl,
            wouldCreate: [
              `GitHub repo ${ctx.env.GITHUB_ORG}/${game_id}`,
              'R2 host route',
              'store listing',
            ],
            liveUrl: `https://${game_id}.freegamestore.online`,
          },
        );
      }

      // Provision via the admin API — the SINGLE scaffold path (same one the
      // VibeCode agent uses). Admin generates the repo from the chosen template
      // (substituting APPNAME), writes the D1 host route, and adds the registry
      // entry. Pass creatorGithub so admin grants push access + records
      // ownership, and template so admin picks the right scaffold. The MCP must
      // NOT re-scaffold afterward — a second force-push (replaceTree) would wipe
      // admin's substituted tree.
      const prov = (await fgsPost(ctx.env.API_BASE, '/api/provision', token, {
        id: game_id,
        name,
        category,
        description: description || name,
        oneliner: description || name,
        creatorGithub: ctx.session.userId,
        template: tmpl,
      })) as {
        error?: string;
        detail?: string;
        success?: boolean;
        appUrl?: string;
        repoUrl?: string;
        steps?: Array<{ name: string; status: string }>;
      };
      if (prov.error)
        return errText(
          `Provision failed: ${prov.error}${prov.detail ? ` — ${typeof prov.detail === 'string' ? prov.detail : JSON.stringify(prov.detail)}` : ''}`,
        );

      // Provision is idempotent and reports the repo step as "skip" when the
      // repo already exists. Don't imply we re-created it.
      const repoStep = prov.steps?.find((s) => s.name === 'GitHub repo');
      if (repoStep?.status === 'skip') {
        return txt(`**${game_id}** already exists — use \`update_files\` to change it.`);
      }

      await audit(ctx.safetyCtx, {
        tool: 'create_game',
        action: 'success',
        input: { game_id, template: tmpl },
        result: { game_id, appUrl: `https://${game_id}.freegamestore.online` },
      });
      return txt(
        `Created **${name}** (${game_id}) from the ${tmpl} template.\n` +
          `Live in ~1-2 min: https://${game_id}.freegamestore.online\n` +
          `Repo: https://github.com/${ctx.env.GITHUB_ORG}/${game_id}\n` +
          `Listing: https://freegamestore.online/games/${game_id}\n\n` +
          `Next: \`list_files\`/\`read_file\` to inspect, \`update_files\` to build it out, \`deploy_status\` to watch it deploy.`,
      );
    },
  );

  // -- list_files --
  ctx.safeTool(
    'list_files',
    "List the files in a game's repo (so you know what to read/edit).",
    { game_id: z.string().describe('Game ID') },
    async ({ game_id }) => {
      const refused = await readableGameError(ctx, game_id);
      if (refused) return refused;
      const files = await listRepoFiles(ctx.env.GITHUB_ORG, game_id, ctx.env.GITHUB_TOKEN);
      if (files.length === 0)
        return txt(`No files found for ${game_id} (repo empty or not found).`);
      return txt(
        `**${game_id}** — ${files.length} files:\n\n${files.map((f) => `- ${f}`).join('\n')}`,
      );
    },
  );

  // -- read_file --
  ctx.safeTool(
    'read_file',
    "Read one file's contents from a game's repo (e.g. web/src/App.tsx).",
    {
      game_id: z.string().describe('Game ID'),
      path: z.string().describe('File path relative to repo root'),
    },
    async ({ game_id, path }) => {
      const refused = await readableGameError(ctx, game_id);
      if (refused) return refused;
      const content = await readRepoFile(ctx.env.GITHUB_ORG, game_id, ctx.env.GITHUB_TOKEN, path);
      if (content === null) return errText(`${path} not found in ${game_id}.`);
      const ext = path.split('.').pop() ?? '';
      return txt(`\`\`\`${ext}\n${content}\n\`\`\``);
    },
  );

  // -- update_files --
  ctx.safeTool(
    'update_files',
    'Improve a game: write/overwrite one or more files in its repo with full new contents. The push auto-deploys to <game_id>.freegamestore.online in ~30-60s. Requires authentication.',
    {
      game_id: z.string().describe('Game ID'),
      files: z
        .array(z.object({ path: z.string(), content: z.string() }))
        .describe('Files to write — each with the FULL new content'),
      message: z.string().optional().describe('Commit message'),
      dry_run: z
        .boolean()
        .optional()
        .describe(
          'Preview only: report which files would be written without pushing or deploying.',
        ),
    },
    async ({ game_id, files, message, dry_run = false }) => {
      const token = ctx.session.token;
      if (!token) return errText('Not authenticated. Connect with a FGS session token.');
      if (!ctx.env.GITHUB_TOKEN)
        return errText('Write tools are disabled (server missing GITHUB_TOKEN).');
      const roBlock = await requireWritable(ctx.safetyCtx, 'update_files', { game_id });
      if (roBlock) return roBlock;
      if (!files?.length) return errText('No files provided.');
      if (!(await ctx.ownsGame(game_id)))
        return errText(
          `You don't own "${game_id}" (or it isn't registered to your login). Only the creator can update it.`,
        );
      if (dry_run) {
        return dryRun(
          ctx.safetyCtx,
          'update_files',
          'push',
          { game_id, files: files.map((f) => f.path) },
          {
            game_id,
            wouldWrite: files.map((f) => f.path),
            message: message || `Update ${game_id} via MCP`,
          },
        );
      }
      const map = new Map<string, RepoFile>(
        files.map((f) => [f.path, { content: textToB64(f.content), encoding: 'base64' as const }]),
      );
      try {
        const sha = await pushFiles(
          ctx.env.GITHUB_ORG,
          game_id,
          ctx.env.GITHUB_TOKEN,
          map,
          message || `Update ${game_id} via MCP`,
        );
        await audit(ctx.safetyCtx, {
          tool: 'update_files',
          action: 'success',
          input: { game_id, files: files.map((f) => f.path) },
          result: { sha: sha.slice(0, 7) },
        });
        return txt(
          `Pushed ${files.length} file(s) to **${game_id}** (${sha.slice(0, 7)}). Auto-deploying to https://${game_id}.freegamestore.online (~30-60s). Use deploy_status to watch.`,
        );
      } catch (e) {
        return errText(`Push failed: ${String(e)}`);
      }
    },
  );
}
