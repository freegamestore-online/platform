import { McpAgent } from "agents/mcp";
import { McpServer, type ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listRepoFiles, pushFiles, readRegistryGames, readRepoFile, type RepoFile, textToB64 } from "./github.js";
import { audit, dryRun, isReadOnly, listAuditEvents, requireConfirmation, requireWritable, type SafetyContext } from "./safety.js";
import { OAuthProvider, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { WorkerEntrypoint } from "cloudflare:workers";
import authHandler from "./auth-handler.js";
import { errMsg, fgsApi, fgsDelete, fgsPost, getDeployStatus, safeFetch, withTimeout } from "./http.js";

interface Env {
  API_BASE: string;
  GITHUB_ORG: string;
  AGENT_BASE: string;
  AUTH_BASE: string;
  LEADERBOARD_BASE: string;
  STORE_REPO: string;
  MCP_OBJECT: DurableObjectNamespace;
  GITHUB_TOKEN?: string;
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  // "1" disables every write tool (safety layer read-only mode).
  MCP_READ_ONLY?: string;
}

const txt = (text: string) => ({ content: [{ type: "text" as const, text }] });
// Failure result carrying isError:true so an agent can detect a failed tool call
// without parsing the message text. Use for every genuine error return (auth,
// validation, ownership, upstream failure) — NOT for empty-but-ok results.
const errText = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true as const });

// Scope VibeCode agent sessions to the caller.
function sessionPrefix(userId?: string): string {
  const u = (userId ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24) || "anon";
  return `mcp-${u}-`;
}

export interface McpProps extends Record<string, unknown> {
  userId?: string;
  token?: string;
}

export class FgsMcpAgent extends McpAgent<Env, unknown, McpProps> {
  server = new McpServer({
    name: "FreeGameStore",
    version: "0.1.0",
  });

  async setAuth(props: McpProps): Promise<void> {
    this.props = props;
    try {
      await (this as unknown as { ctx: { storage: { put(k: string, v: unknown): Promise<void> } } }).ctx.storage.put("props", props);
    } catch {
      /* in-memory set is enough for the immediately-following tool call */
    }
  }

  /** Ownership gate: does the session user own this published game?
   *  FGS has no /v1/apps/mine — registry.json's creatorGithub is the record. */
  private async ownsGame(gameId: string): Promise<boolean> {
    const login = this.props.userId;
    if (!login) return false;
    const games = await readRegistryGames(this.env.GITHUB_ORG, this.env.STORE_REPO, this.env.GITHUB_TOKEN);
    // GitHub logins are case-insensitive; the agent/publisher/admin all compare
    // lowercased. Match that here so registry casing drift doesn't wrongly deny.
    return games.some((g) => g.id === gameId && g.creatorGithub?.toLowerCase() === login.toLowerCase());
  }

  /** Safety context for the current caller: env (read-only flag + audit KV) and
   *  the GitHub login the audit trail is keyed on. */
  private safety(): SafetyContext {
    return { env: this.env, subject: this.props.userId };
  }

  /**
   * Register a tool whose handler can never throw past us.
   *
   * The targeted fixes above give a specific message for each upstream hop, but
   * this is a 23-tool surface that will grow new call sites, and any uncaught
   * throw renders as the opaque "Tool error: MCP tool call failed" (#29) with
   * no clue which one broke. This is the backstop: whatever escapes, the caller
   * gets the tool name and the real message, flagged isError so an agent can
   * detect the failure without parsing prose.
   *
   * The signature mirrors McpServer.tool() and reuses the SDK's own
   * ToolCallback, so each handler keeps the argument types inferred from its
   * Zod schema. Do not loosen this to `unknown[]` — that silently turns every
   * destructured handler parameter into `any`.
   *
   * NOTE: test/safety.test.mjs discovers the registered tool set by matching
   * this call by name. Renaming it means updating that regex too.
   */
  private safeTool<Args extends z.ZodRawShape>(
    name: string,
    description: string,
    paramsSchema: Args,
    cb: ToolCallback<Args>,
  ): void {
    const guarded = (async (...callArgs: Parameters<ToolCallback<Args>>) => {
      try {
        return await (cb as (...a: unknown[]) => Promise<unknown>)(...callArgs);
      } catch (err: unknown) {
        return errText(`${name} failed: ${errMsg(err)}`);
      }
    }) as ToolCallback<Args>;
    this.server.tool(name, description, paramsSchema, guarded);
  }

  async init() {
    // -- list_games --
    this.safeTool(
      "list_games",
      "List all published games on FreeGameStore (from the store registry). No auth needed.",
      {},
      async () => {
        const data = (await fgsApi(this.env.API_BASE, "/api/status")) as
          | Array<{ id: string; name: string; domain: string; org: string }>
          | { error: string }
          | null;
        // null is a real fgsApi return (204 / empty body); reading .error off it
        // would throw and resurface as the opaque wrapper this tool just fixed.
        if (data === null) return errText("No game data returned from /api/status (empty response)");
        if (!Array.isArray(data)) return errText(`Error: ${(data as { error?: string }).error ?? "unexpected response"}`);
        const games = data as Array<{ id: string; name: string; domain: string; org: string }>;
        if (games.length === 0) return txt("No games published yet.");
        const lines = games.map(
          (g) => `- **${g.name}** (${g.id}) — https://${g.domain}`
        );
        return txt(`${games.length} game(s):\n\n${lines.join("\n")}`);
      }
    );

    // -- deploy_status --
    this.safeTool(
      "deploy_status",
      "Check the deploy status of a game (last 5 GitHub Actions runs). No auth needed for public repos.",
      { game_id: z.string().describe("Game ID (e.g. 'chess', 'tetris')") },
      async ({ game_id }) => {
        const runs = await getDeployStatus(this.env.GITHUB_ORG, game_id);
        if (!Array.isArray(runs)) return errText(`Error: ${(runs as { error: string }).error}`);
        if (runs.length === 0)
          return txt(`No workflow runs found for ${game_id}.`);
        const lines = runs.map(
          (r) => `- ${r.status === "success" ? "OK" : r.status === "failure" ? "FAIL" : "..."} ${r.name} (${r.sha}) — ${r.updatedAt}\n  ${r.url}`
        );
        return txt(`Deploy history for **${game_id}**:\n\n${lines.join("\n")}`);
      }
    );

    // -- game_info --
    this.safeTool(
      "game_info",
      "Get info about any game on FreeGameStore — live URL, repo, store listing.",
      { game_id: z.string().describe("Game ID (e.g. 'chess', 'tetris')") },
      async ({ game_id }) => {
        const domain = "freegamestore.online";
        const org = this.env.GITHUB_ORG;
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
        const games = await readRegistryGames(org, this.env.STORE_REPO, this.env.GITHUB_TOKEN);
        const entry = games.find((g) => g.id === game_id);
        // Absent entry → unlisted; absent status → predates the field, so live.
        const buildStatus = !entry
          ? "unlisted"
          : entry.status === "pending" || entry.status === "failed"
            ? entry.status
            : "live";

        let status: string;
        if (buildStatus === "unlisted") {
          status = "Not listed in the store registry";
        } else if (buildStatus === "pending") {
          status = "Building — provisioned, but no successful build yet (not live)";
        } else if (buildStatus === "failed") {
          status = "Build failed — has never deployed successfully (not live)";
        } else {
          try {
            const check = await withTimeout((signal) => fetch(liveUrl, { method: "HEAD", signal }));
            status = check.ok ? "Live (200)" : `Down (${check.status})`;
          } catch {
            status = "Unreachable";
          }
        }

        return {
          content: [{
            type: "text" as const,
            text: [
              `**${game_id}**`,
              `Status: ${status}`,
              `Live: ${liveUrl}`,
              `Repo: ${repoUrl}`,
              `Listing: ${listingUrl}`,
              `Deploy: push to main auto-deploys via GitHub Actions -> R2`,
            ].join("\n"),
          }],
        };
      }
    );

    // -- game_quality --
    this.safeTool(
      "game_quality",
      "Get quality audit results for games (scores, load times, console errors). No auth needed.",
      { game_id: z.string().optional().describe("Game ID to filter (omit for all games)") },
      async ({ game_id }) => {
        const data = (await fgsApi(this.env.API_BASE, "/api/quality")) as
          | { timestamp: string; games: Array<{ id: string; score: number; loadTimeMs: number; consoleErrors: string[] }> }
          | { error: string }
          | null;
        if (!data || typeof data !== "object") return txt("No quality audit data available yet.");
        if ("error" in data) return errText(`Error: ${(data as { error: string }).error}`);
        const qd = data as { timestamp: string; games: Array<{ id: string; score: number; loadTimeMs: number; consoleErrors: string[] }> };
        if (!qd.games) return txt("No quality audit data available yet.");
        let games = qd.games ?? [];
        if (game_id) games = games.filter((g) => g.id === game_id);
        if (games.length === 0) return txt(game_id ? `No quality data for ${game_id}.` : "No quality data available.");
        const lines = games.map((g) => {
          const errs = g.consoleErrors ?? [];
          const errors = errs.length > 0 ? ` | Errors: ${errs.join(", ")}` : "";
          return `- **${g.id}**: score ${g.score}/100, load ${g.loadTimeMs}ms${errors}`;
        });
        return txt(`Quality audit (${qd.timestamp}):\n\n${lines.join("\n")}`);
      }
    );

    // -- leaderboard --
    this.safeTool(
      "leaderboard",
      "Query the leaderboard for a game — top scores and recent scores.",
      {
        game_id: z.string().describe("Game ID"),
        limit: z.number().optional().describe("Max entries (default 10)"),
      },
      async ({ game_id, limit }) => {
        const n = limit ?? 10;
        const r = await safeFetch("the leaderboard API", (signal) => fetch(
          `${this.env.LEADERBOARD_BASE}/api/leaderboard/${game_id}?limit=${n}`,
          { headers: { "User-Agent": "freegamestore-mcp" }, signal }
        ));
        if ("error" in r) return errText(r.error);
        const res = r.res;
        if (!res.ok) return errText(`Leaderboard API error: ${res.status}`);
        // The worker returns rows keyed `player_name` (not `name`); keep `name`
        // as a fallback so this doesn't render "**undefined**".
        let data: { scores?: Array<{ player_name?: string; name?: string; score: number; created_at: string }> };
        try {
          data = (await res.json()) as typeof data;
        } catch {
          return errText(`Leaderboard API returned invalid JSON.`);
        }
        const scores = data.scores ?? [];
        if (scores.length === 0) return txt(`No leaderboard entries for ${game_id}.`);
        const lines = scores.map(
          (s, i) => `${i + 1}. **${s.player_name ?? s.name ?? "Anonymous"}** — ${s.score} (${new Date(s.created_at).toLocaleDateString()})`
        );
        return txt(`Leaderboard for **${game_id}** (top ${scores.length}):\n\n${lines.join("\n")}`);
      }
    );

    // -- platform_guide --
    this.safeTool(
      "platform_guide",
      "Get the FreeGameStore platform guide for AI-assisted game development.",
      {},
      async () => {
        for (const path of ["/SKILLS.md", "/skills.md"]) {
          const res = await withTimeout((signal) => fetch(`https://freegamestore.online${path}`, { signal }));
          if (res.ok) return txt(await res.text());
          await res.body?.cancel();
        }
        return errText("Failed to fetch SKILLS.md from freegamestore.online.");
      }
    );

    // -- sdk_reference --
    this.safeTool(
      "sdk_reference",
      "Quick reference for @freegamestore/games SDK — imports, features, and usage patterns for auth, leaderboard, sound, and UI components.",
      { feature: z.enum(["all", "shell", "auth", "leaderboard", "sound", "ui"]).optional().describe("Specific feature, or 'all'") },
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
          leaderboard: `## Leaderboard
\`\`\`tsx
import { useLeaderboard, Leaderboard } from '@freegamestore/games'

const { topScores, recentScores, submitScore, loading, refresh } = useLeaderboard('my-game')
await submitScore(1500)  // signed-in users get their name from the auth cookie

// Drop-in board UI:
<Leaderboard topScores={topScores} recentScores={recentScores} loading={loading} />
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

        const selected = feature === "all" || !feature
          ? Object.values(sections).join("\n\n")
          : sections[feature] ?? `Unknown feature: ${feature}`;

        return txt(`# @freegamestore/games SDK Reference\n\n${selected}`);
      }
    );

    // -- create_game (provision + scaffold + go live) --
    this.safeTool(
      "create_game",
      "Create AND publish a brand-new game on FreeGameStore, end to end. Provisions the GitHub repo + R2 hosting + store listing, scaffolds the chosen template, and pushes it so the game deploys live at <game_id>.freegamestore.online (~1-2 min). Then use read_file/update_files to build it out. Requires authentication.",
      {
        game_id: z.string().describe("Game slug: lowercase letters/numbers/hyphens. Becomes <game_id>.freegamestore.online"),
        name: z.string().describe("Display name (e.g. 'Chess', 'Space Invaders')"),
        category: z.string().describe("puzzle, arcade, strategy, card, board, trivia, racing, sports, action, simulation, or educational"),
        description: z.string().optional().describe("Short description"),
        template: z
          .enum(["kaplay", "phaser", "3d", "pixi", "babylon", "excalibur", "littlejs", "canvas", "grid", "cards"])
          .optional()
          .describe(
            "Engine/template to build on (default: canvas). Engines: 'kaplay' = beginner-friendly 2D arcade engine; 'phaser' = production 2D engine (scenes, arcade physics); '3d' = Three.js + react-three-fiber; 'pixi' = Pixi.js v8 WebGL 2D (particles, sprites); 'babylon' = Babylon.js 3D engine; 'excalibur' = TypeScript-native actor-based 2D; 'littlejs' = tiny all-in-one arcade (particles + procedural sound built in). Starters: 'canvas' = raw HTML5 canvas 2D; 'grid' = CSS-grid puzzle/board; 'cards' = DOM card game.",
          ),
        dry_run: z.boolean().optional().describe("Preview only: validate and report what would be provisioned without creating the repo, hosting, or listing."),
      },
      async ({ game_id, name, category, description, template, dry_run = false }) => {
        const token = this.props.token;
        if (!token) return errText("Not authenticated. Connect with a FGS session token to create games.");
        if (!this.env.GITHUB_TOKEN) return errText("Write tools are disabled (server missing GITHUB_TOKEN).");
        const roBlock = await requireWritable(this.safety(), "create_game", { game_id, template });
        if (roBlock) return roBlock;

        const tmpl = template ?? "canvas";

        if (dry_run) {
          return dryRun(this.safety(), "create_game", "provision", { game_id, name, category, template: tmpl }, {
            game_id,
            template: tmpl,
            wouldCreate: [`GitHub repo ${this.env.GITHUB_ORG}/${game_id}`, "R2 host route", "store listing"],
            liveUrl: `https://${game_id}.freegamestore.online`,
          });
        }

        // Provision via the admin API — the SINGLE scaffold path (same one the
        // VibeCode agent uses). Admin generates the repo from the chosen template
        // (substituting APPNAME), writes the D1 host route, and adds the registry
        // entry. Pass creatorGithub so admin grants push access + records
        // ownership, and template so admin picks the right scaffold. The MCP must
        // NOT re-scaffold afterward — a second force-push (replaceTree) would wipe
        // admin's substituted tree.
        const prov = (await fgsPost(this.env.API_BASE, "/api/provision", token, {
          id: game_id,
          name,
          category,
          description: description || name,
          oneliner: description || name,
          creatorGithub: this.props.userId,
          template: tmpl,
        })) as { error?: string; detail?: string; success?: boolean; appUrl?: string; repoUrl?: string; steps?: Array<{ name: string; status: string }> };
        if (prov.error) return errText(`Provision failed: ${prov.error}${prov.detail ? ` — ${typeof prov.detail === "string" ? prov.detail : JSON.stringify(prov.detail)}` : ""}`);

        // Provision is idempotent and reports the repo step as "skip" when the
        // repo already exists. Don't imply we re-created it.
        const repoStep = prov.steps?.find((s) => s.name === "GitHub repo");
        if (repoStep?.status === "skip") {
          return txt(`**${game_id}** already exists — use \`update_files\` to change it.`);
        }

        await audit(this.safety(), { tool: "create_game", action: "success", input: { game_id, template: tmpl }, result: { game_id, appUrl: `https://${game_id}.freegamestore.online` } });
        return txt(
          `Created **${name}** (${game_id}) from the ${tmpl} template.\n` +
          `Live in ~1-2 min: https://${game_id}.freegamestore.online\n` +
          `Repo: https://github.com/${this.env.GITHUB_ORG}/${game_id}\n` +
          `Listing: https://freegamestore.online/games/${game_id}\n\n` +
          `Next: \`list_files\`/\`read_file\` to inspect, \`update_files\` to build it out, \`deploy_status\` to watch it deploy.`,
        );
      },
    );

    // -- list_files --
    this.safeTool(
      "list_files",
      "List the files in a game's repo (so you know what to read/edit).",
      { game_id: z.string().describe("Game ID") },
      async ({ game_id }) => {
        const files = await listRepoFiles(this.env.GITHUB_ORG, game_id, this.env.GITHUB_TOKEN);
        if (files.length === 0) return txt(`No files found for ${game_id} (repo empty or not found).`);
        return txt(`**${game_id}** — ${files.length} files:\n\n${files.map((f) => `- ${f}`).join("\n")}`);
      },
    );

    // -- read_file --
    this.safeTool(
      "read_file",
      "Read one file's contents from a game's repo (e.g. web/src/App.tsx).",
      { game_id: z.string().describe("Game ID"), path: z.string().describe("File path relative to repo root") },
      async ({ game_id, path }) => {
        const content = await readRepoFile(this.env.GITHUB_ORG, game_id, this.env.GITHUB_TOKEN, path);
        if (content === null) return errText(`Could not read ${path} from ${game_id} (not found?).`);
        const ext = path.split(".").pop() ?? "";
        return txt(`\`\`\`${ext}\n${content}\n\`\`\``);
      },
    );

    // -- update_files --
    this.safeTool(
      "update_files",
      "Improve a game: write/overwrite one or more files in its repo with full new contents. The push auto-deploys to <game_id>.freegamestore.online in ~30-60s. Requires authentication.",
      {
        game_id: z.string().describe("Game ID"),
        files: z.array(z.object({ path: z.string(), content: z.string() })).describe("Files to write — each with the FULL new content"),
        message: z.string().optional().describe("Commit message"),
        dry_run: z.boolean().optional().describe("Preview only: report which files would be written without pushing or deploying."),
      },
      async ({ game_id, files, message, dry_run = false }) => {
        const token = this.props.token;
        if (!token) return errText("Not authenticated. Connect with a FGS session token.");
        if (!this.env.GITHUB_TOKEN) return errText("Write tools are disabled (server missing GITHUB_TOKEN).");
        const roBlock = await requireWritable(this.safety(), "update_files", { game_id });
        if (roBlock) return roBlock;
        if (!files?.length) return errText("No files provided.");
        if (!(await this.ownsGame(game_id)))
          return errText(`You don't own "${game_id}" (or it isn't registered to your login). Only the creator can update it.`);
        if (dry_run) {
          return dryRun(this.safety(), "update_files", "push", { game_id, files: files.map((f) => f.path) }, {
            game_id,
            wouldWrite: files.map((f) => f.path),
            message: message || `Update ${game_id} via MCP`,
          });
        }
        const map = new Map<string, RepoFile>(
          files.map((f) => [f.path, { content: textToB64(f.content), encoding: "base64" as const }]),
        );
        try {
          const sha = await pushFiles(this.env.GITHUB_ORG, game_id, this.env.GITHUB_TOKEN, map, message || `Update ${game_id} via MCP`);
          await audit(this.safety(), { tool: "update_files", action: "success", input: { game_id, files: files.map((f) => f.path) }, result: { sha: sha.slice(0, 7) } });
          return txt(`Pushed ${files.length} file(s) to **${game_id}** (${sha.slice(0, 7)}). Auto-deploying to https://${game_id}.freegamestore.online (~30-60s). Use deploy_status to watch.`);
        } catch (e) {
          return errText(`Push failed: ${String(e)}`);
        }
      },
    );

    // -- agent_build (delegate code-gen to the platform's VibeCode agent) --
    this.safeTool(
      "agent_build",
      "Hand a natural-language prompt to the FreeGameStore VibeCode AGENT — the platform's own AI writes the code AND deploys it. By default it uses the AI key saved for your account (the platform's encrypted key vault); pass api_key only to override with a different key. Long-running; builds in the background. Returns session_id — poll agent_status for progress.",
      {
        prompt: z.string().describe("What to build, in plain English. Include a desired game id."),
        game_id: z.string().optional().describe("Existing game to work on: imports its repo into the session (engine-correct guidance + push_update instead of a fresh deploy). Omit when building a brand-new game."),
        template: z.enum(["kaplay", "phaser", "3d", "pixi", "babylon", "excalibur", "littlejs", "canvas", "grid", "cards"]).optional().describe("Engine template a BRAND-NEW game session seeds from (default canvas). Ignored when game_id is set or the session already exists."),
        api_key: z.string().optional().describe("Override key. Optional — defaults to the key saved for your account in the vault. Provider must match the saved key (or pass provider)."),
        provider: z.enum(["anthropic", "openai", "google", "github"]).optional().describe("AI provider (default anthropic). Must match the saved/override key."),
        model: z.string().optional().describe("Model id"),
        session_id: z.string().optional().describe("Continue an existing build session"),
        dry_run: z.boolean().optional().describe("Preview only: report the resolved session and target without running the agent or deploying."),
      },
      async ({ prompt, game_id, template, api_key, provider, model, session_id, dry_run = false }) => {
        const token = this.props.token;
        if (!token) return errText("Not authenticated. Connect with a FGS session token.");
        const roBlock = await requireWritable(this.safety(), "agent_build", { game_id, template });
        if (roBlock) return roBlock;
        const prov = provider ?? "anthropic";
        const defaultModel: Record<string, string> = {
          anthropic: "claude-sonnet-4-6",
          openai: "gpt-4o",
          google: "gemini-2.5-flash",
          github: "openai/gpt-4o",
        };
        const prefix = sessionPrefix(this.props.userId);
        const sid = session_id
          ? session_id.startsWith(prefix)
            ? session_id
            : prefix + session_id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40)
          : prefix + crypto.randomUUID().slice(0, 12);
        if (dry_run) {
          return dryRun(this.safety(), "agent_build", game_id ? "edit" : "build", { prompt, game_id, template, provider: prov }, {
            session_id: sid,
            provider: prov,
            model: model ?? defaultModel[prov] ?? "claude-sonnet-4-6",
            target: game_id ?? "(new game)",
            note: "Would run one VibeCode agent turn and deploy; nothing is written in dry-run.",
          });
        }
        // Bind the session to an existing game BEFORE the first turn: /import
        // loads the repo's committed files into the session, so the agent gets
        // engine-correct guidance (detectEngine reads web/package.json) and
        // push_update targets the real game instead of dead-ending on "ID taken".
        if (game_id) {
          const imp = await fetch(`${this.env.AGENT_BASE}/session/${sid}/import`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ id: game_id }),
          });
          if (!imp.ok) {
            return errText(`Could not open "${game_id}" in the session (${imp.status}): ${(await imp.text()).slice(0, 300)}`);
          }
        }
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 110_000);
        let phases: string[] = [];
        let gameId: string | null = null;
        let timedOut = false;
        try {
          const res = await fetch(`${this.env.AGENT_BASE}/session/${sid}/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            // Omit apiKey when not overridden so the agent resolves the account's
            // vault key server-side (session.ts: aiConfig.apiKey || resolveUserKey).
            body: JSON.stringify({ message: prompt, aiConfig: { provider: prov, model: model ?? defaultModel[prov] ?? "claude-sonnet-4-6", ...(api_key ? { apiKey: api_key } : {}) }, ...(template && !game_id ? { engine: template } : {}) }),
            signal: ctrl.signal,
          });
          if (!res.ok || !res.body) {
            clearTimeout(timer);
            return errText(`Agent chat failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
          }
          const reader = res.body.getReader();
          const dec = new TextDecoder();
          let buf = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const parts = buf.split("\n\n");
            buf = parts.pop() ?? "";
            for (const p of parts) {
              const line = p.split("\n").find((l) => l.startsWith("data: "));
              if (!line) continue;
              try {
                const ev = JSON.parse(line.slice(6));
                if ((ev.type === "deploy" || ev.type === "deploy_status") && ev.data) {
                  try {
                    const d = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
                    if (d.phase) phases.push(d.phase);
                    if (d.appId) gameId = d.appId;
                  } catch { /* */ }
                }
                if (ev.appId) gameId = ev.appId;
              } catch { /* */ }
            }
          }
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") {
            timedOut = true;
          } else {
            clearTimeout(timer);
            return errText(`Agent request failed: ${String(err)}`);
          }
        }
        clearTimeout(timer);
        const last = phases[phases.length - 1];
        const liveLine = gameId ? `Live (when built): https://${gameId}.freegamestore.online` : "";
        await audit(this.safety(), { tool: "agent_build", action: "success", input: { prompt, game_id }, result: { session_id: sid, gameId, lastPhase: last, timedOut } });
        return txt(
          `${timedOut ? "Agent still building" : "Agent turn finished"} (session \`${sid}\`).\n` +
          (gameId ? `Game: **${gameId}**\n` : "") +
          (last ? `Last deploy phase: ${last}\n` : "") +
          `${liveLine}\n\nPoll \`agent_status\` with session_id="${sid}" for progress + the live URL.`,
        );
      },
    );

    // -- edit_game (open an EXISTING game in VibeCode; always re-syncs the repo) --
    this.safeTool(
      "edit_game",
      "Open one of YOUR existing games in VibeCode and (optionally) tell the agent what to change. Imports the game's CURRENT repo files into a session — so it ALWAYS picks up changes made directly (update_files / git / the web console) since last time — then, if you pass a prompt + api_key, the platform's agent edits and redeploys via push_update (files it doesn't touch are preserved). Direct editing (update_files) and VibeCode are two ways to work on the SAME game; this is the VibeCode entry point for an existing one. Ownership-gated. Returns a session_id — poll agent_status.",
      {
        game_id: z.string().describe("The id/slug of a game you own, e.g. 'kart-racers'"),
        prompt: z.string().optional().describe("What to change, in plain English. Omit to just open/sync without editing."),
        api_key: z.string().optional().describe("Override key. Optional — defaults to the key saved for your account in the vault."),
        provider: z.enum(["anthropic", "openai", "google", "github"]).optional().describe("AI provider (default anthropic). Must match the saved/override key."),
        model: z.string().optional().describe("Model id"),
      },
      async ({ game_id, prompt, api_key, provider, model }) => {
        const token = this.props.token;
        if (!token) return errText("Not authenticated. Connect with a FGS session token.");
        const roBlock = await requireWritable(this.safety(), "edit_game", { game_id });
        if (roBlock) return roBlock;
        const gid = game_id.trim().toLowerCase();
        if (!/^[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/.test(gid)) return errText(`Invalid game id: \`${game_id}\`.`);

        // Deterministic session per (user, game): reopening continues the same
        // VibeCode conversation. Kept ≤64 chars (agent route cap) and prefixed so
        // agent_status accepts it.
        const prefix = sessionPrefix(this.props.userId);
        const sid = `${prefix}g-${gid}`.slice(0, 64);

        // 1) Import / re-sync from the repo HEAD (ownership enforced server-side).
        const imp = await fetch(`${this.env.AGENT_BASE}/session/${sid}/import`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ id: gid }),
        });
        const impData = (await imp.json().catch(() => ({}))) as { ok?: boolean; error?: string; name?: string; appUrl?: string; fileCount?: number; unchanged?: boolean };
        if (!imp.ok || !impData.ok) {
          const hint = imp.status === 403 ? " (you can only edit games you own)" : imp.status === 404 ? " (no such game)" : "";
          return errText(`Couldn't open \`${gid}\`: ${impData.error || `HTTP ${imp.status}`}${hint}`);
        }
        const name = impData.name || gid;
        const appUrl = impData.appUrl || `https://${gid}.freegamestore.online`;

        // 2) Register in the D1 session index so it shows in list_sessions + the
        //    web console (the DO doesn't write D1 itself).
        await fetch(`${this.env.AGENT_BASE}/sessions/${sid}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", "X-FGS-Token": token },
          body: JSON.stringify({ title: name, gameId: gid, gameUrl: appUrl, deployed: true }),
        }).catch(() => {});

        const opened = `Opened **${name}** (\`${gid}\`) in VibeCode — ${impData.fileCount ?? "?"} file(s) ${impData.unchanged ? "already in sync" : "synced"} from the repo. Session \`${sid}\`.`;
        if (!prompt) return txt(`${opened}\n\nCall edit_game again with a \`prompt\` to have the agent make changes (it uses your saved key), or use update_files to edit directly.`);

        // 3) Run one agent turn (same streaming contract as agent_build).
        const prov = provider ?? "anthropic";
        const defaultModel: Record<string, string> = { anthropic: "claude-sonnet-4-6", openai: "gpt-4o", google: "gemini-2.5-flash", github: "openai/gpt-4o" };
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 110_000);
        const phases: string[] = [];
        let timedOut = false;
        try {
          const res = await fetch(`${this.env.AGENT_BASE}/session/${sid}/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            // Omit apiKey when not overridden → agent uses the account vault key.
            body: JSON.stringify({ message: prompt, aiConfig: { provider: prov, model: model ?? defaultModel[prov] ?? "claude-sonnet-4-6", ...(api_key ? { apiKey: api_key } : {}) } }),
            signal: ctrl.signal,
          });
          if (!res.ok || !res.body) { clearTimeout(timer); return errText(`${opened}\n\nAgent edit failed (${res.status}): ${(await res.text()).slice(0, 300)}`); }
          const reader = res.body.getReader();
          const dec = new TextDecoder();
          let buf = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const parts = buf.split("\n\n");
            buf = parts.pop() ?? "";
            for (const p of parts) {
              const line = p.split("\n").find((l) => l.startsWith("data: "));
              if (!line) continue;
              try {
                const ev = JSON.parse(line.slice(6));
                if ((ev.type === "deploy" || ev.type === "deploy_status") && ev.data) {
                  const d = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
                  if (d.phase) phases.push(d.phase);
                }
              } catch { /* non-JSON keepalive */ }
            }
          }
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") timedOut = true;
          else { clearTimeout(timer); return errText(`${opened}\n\nAgent request failed: ${String(err)}`); }
        }
        clearTimeout(timer);
        const last = phases[phases.length - 1];
        await audit(this.safety(), { tool: "edit_game", action: "success", input: { game_id: gid, hasPrompt: !!prompt }, result: { session_id: sid, lastPhase: last, timedOut } });
        return txt(
          `${opened}\n\n${timedOut ? "Agent still working" : "Agent turn finished"}.\n` +
          (last ? `Last deploy phase: ${last}\n` : "") +
          `Live: ${appUrl}\n\nPoll \`agent_status\` with session_id="${sid}" for progress.`,
        );
      },
    );

    // -- agent_status --
    this.safeTool(
      "agent_status",
      "Check a VibeCode agent build session (started with agent_build): the game id, deploy phase, and live URL.",
      { session_id: z.string().describe("The session_id returned by agent_build") },
      async ({ session_id }) => {
        const token = this.props.token;
        if (!token) return errText("Not authenticated. Connect with a FGS session token.");
        if (!session_id.startsWith(sessionPrefix(this.props.userId)))
          return errText("That session isn't one of yours — agent sessions are scoped to your account.");
        const res = await fetch(`${this.env.AGENT_BASE}/session/${session_id}/status`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return errText(`Status fetch failed (${res.status}).`);
        let s: { appId?: string | null; appUrl?: string | null; deployStatus?: { phase?: string; error?: string } | null; messageCount?: number };
        try {
          s = (await res.json()) as typeof s;
        } catch {
          return errText("Agent status returned invalid JSON.");
        }
        const lines = [
          `Session **${session_id}**`,
          `Game: ${s.appId ?? "(not deployed yet)"}`,
          `Deploy phase: ${s.deployStatus?.phase ?? "—"}${s.deployStatus?.error ? ` (error: ${s.deployStatus.error.slice(0, 200)})` : ""}`,
          s.appUrl ? `Live: ${s.appUrl}` : s.appId ? `URL (once live): https://${s.appId}.freegamestore.online` : "",
          `Messages: ${s.messageCount ?? 0}`,
        ].filter(Boolean);
        return txt(lines.join("\n"));
      },
    );

    // -- whoami (the authenticated user, straight from the OAuth props) --
    this.safeTool(
      "whoami",
      "Show who you're authenticated as on the FreeGameStore MCP — your GitHub login and token identity.",
      {},
      async () => {
        const login = this.props.userId;
        const token = this.props.token;
        if (!login && !token) return errText("Not authenticated — no session on this MCP connection.");
        let claims = "";
        if (token) {
          try {
            const p = token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/");
            const payload = JSON.parse(atob(p + "===".slice(0, (4 - (p.length % 4)) % 4))) as { sub?: string; name?: string; login?: string; exp?: number };
            const exp = payload.exp ? new Date(payload.exp * 1000).toISOString() : "—";
            claims = `\n- login: ${payload.login ?? "—"}\n- name: ${payload.name ?? "—"}\n- sub: ${payload.sub ?? "—"}\n- token expires: ${exp}`;
          } catch { /* unsigned read, best effort */ }
        }
        const ro = isReadOnly(this.env) ? "\n\n**Read-only mode is ON** (MCP_READ_ONLY=1) — every write tool is disabled; reads and dry-runs still work." : "";
        return txt(`You are authenticated as **${login ?? "(unknown)"}**.${claims}${ro}`);
      },
    );

    // -- list_sessions (your VibeCode sessions from the web console) --
    this.safeTool(
      "list_sessions",
      "List YOUR VibeCode sessions from the web console — title, game, last updated. These are the chats where you built games with the platform's AI. Use session_history to read a transcript.",
      {},
      async () => {
        const token = this.props.token;
        if (!token) return errText("Not authenticated. Connect with a FGS session token.");
        const res = await fetch(`${this.env.AGENT_BASE}/sessions`, { headers: { "X-FGS-Token": token } });
        if (!res.ok) return errText(`Could not list sessions (${res.status}). Your VibeCode session list isn't reachable yet — use session_history with a session id (from a console.freegamestore.online/create/<id> URL) to read a specific chat.`);
        let data: { sessions?: Array<{ id: string; name: string; gameId?: string; deployed?: boolean; createdAt?: string }> };
        try { data = (await res.json()) as typeof data; } catch { return errText("Sessions returned invalid JSON."); }
        const sessions = data.sessions ?? [];
        if (!sessions.length) {
          return txt("No VibeCode sessions found server-side yet. Open console.freegamestore.online once while signed in to sync your existing sessions, then try again. (Old sessions live only in that browser's storage until synced.) You can also read any session directly with session_history if you have its id.");
        }
        const lines = sessions.map((s, i) =>
          `${i + 1}. **${s.name || "Untitled"}** — \`${s.id}\`${s.gameId ? ` · game: ${s.gameId}` : ""}${s.deployed ? " · deployed" : ""}${s.createdAt ? ` · ${s.createdAt}` : ""}`,
        );
        return txt(`${sessions.length} VibeCode session(s), newest first:\n\n${lines.join("\n")}\n\nUse session_history with a session id to read the chat.`);
      },
    );

    // -- session_history (read a VibeCode chat transcript) --
    this.safeTool(
      "session_history",
      "Read the full chat transcript of a VibeCode session by id (from list_sessions, or a console.freegamestore.online/create/<id> URL) — the conversation between you and the platform's AI game builder.",
      { session_id: z.string().describe("VibeCode session id") },
      async ({ session_id }) => {
        const token = this.props.token;
        if (!token) return errText("Not authenticated. Connect with a FGS session token.");
        // The agent worker gates every /session/* route — without the token this
        // always 401'd. resolveUser accepts a Bearer token.
        const res = await fetch(`${this.env.AGENT_BASE}/session/${encodeURIComponent(session_id)}/history`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return errText(`Could not fetch history (${res.status}).`);
        let data: { messages?: Array<{ role: string; content?: string; toolCalls?: Array<{ name: string }> }>; appId?: string | null; appName?: string | null };
        try { data = (await res.json()) as typeof data; } catch { return errText("History returned invalid JSON."); }
        const msgs = data.messages ?? [];
        if (!msgs.length) return txt(`Session \`${session_id}\` has no messages (empty or unknown session id).`);
        const out = msgs.map((m) => {
          const c = (m.content || "").slice(0, 2000);
          if (m.role === "user") return `**You:** ${c}`;
          if (m.role === "assistant") {
            const tools = (m.toolCalls ?? []).map((t) => `\`${t.name}\``).join(", ");
            return `**AI:** ${c}${tools ? `\n  _(tools: ${tools})_` : ""}`;
          }
          return `_${m.role}:_ ${(m.content || "").slice(0, 500)}`;
        });
        const header = data.appName || data.appId ? `Game: **${data.appName || data.appId}**\n\n` : "";
        return txt(`Transcript of \`${session_id}\` (${msgs.length} messages):\n\n${header}${out.join("\n\n")}`);
      },
    );

    // -- admin_list_sessions (org admins: every user's sessions) --
    this.safeTool(
      "admin_list_sessions",
      "PLATFORM ADMINS (org members) ONLY: list EVERY user's VibeCode sessions across the platform — who built what, token spend, last activity. Pair with admin_session_history to read any transcript. Non-admins get 403.",
      {},
      async () => {
        const token = this.props.token;
        if (!token) return errText("Not authenticated. Connect with a FGS session token.");
        const res = await withTimeout((signal) => fetch(`${this.env.AGENT_BASE}/admin/sessions`, {
          headers: { "X-FGS-Token": token, Authorization: `Bearer ${token}` }, signal,
        }));
        if (res.status === 403) return errText("Forbidden — this tool is for platform admins (GitHub org members) only.");
        if (!res.ok) return errText(`Could not list sessions (${res.status}).`);
        let data: { sessions?: Array<{ id: string; user: string; name: string; gameId?: string; deployed?: boolean; tokens?: { input: number; output: number }; updatedAt?: string }> };
        try { data = (await res.json()) as typeof data; } catch { return errText("Admin sessions returned invalid JSON."); }
        const sessions = data.sessions ?? [];
        if (!sessions.length) return txt("No sessions recorded on the platform yet.");
        const lines = sessions.map((s, i) =>
          `${i + 1}. **${s.name || "Untitled"}** by \`${s.user}\` — \`${s.id}\`${s.gameId ? ` · game: ${s.gameId}` : ""}${s.deployed ? " · deployed" : " · draft"}${s.updatedAt ? ` · ${s.updatedAt}` : ""}`,
        );
        return txt(`${sessions.length} session(s) platform-wide, newest first:\n\n${lines.join("\n")}\n\nUse admin_session_history with a session id to read any chat.`);
      },
    );

    // -- admin_session_history (org admins: read anyone's transcript) --
    this.safeTool(
      "admin_session_history",
      "PLATFORM ADMINS (org members) ONLY: read the full chat transcript of ANY user's VibeCode session by id (from admin_list_sessions). Read-only. Non-admins get 403.",
      { session_id: z.string().describe("VibeCode session id (any user's)") },
      async ({ session_id }) => {
        const token = this.props.token;
        if (!token) return errText("Not authenticated. Connect with a FGS session token.");
        // ?admin=1 asks the agent worker to verify org membership and pass the
        // read-only admin flag to the session DO (bypasses the ownership gate
        // for GET history/status only).
        const res = await withTimeout((signal) => fetch(`${this.env.AGENT_BASE}/session/${encodeURIComponent(session_id)}/history?admin=1`, {
          headers: { "X-FGS-Token": token, Authorization: `Bearer ${token}` }, signal,
        }));
        if (res.status === 403) return errText("Forbidden — you don't own this session and aren't a platform admin (org member).");
        if (!res.ok) return errText(`Could not fetch history (${res.status}).`);
        let data: { messages?: Array<{ role: string; content?: string; toolCalls?: Array<{ name: string }> }>; appId?: string | null; appName?: string | null };
        try { data = (await res.json()) as typeof data; } catch { return errText("History returned invalid JSON."); }
        const msgs = data.messages ?? [];
        if (!msgs.length) return txt(`Session \`${session_id}\` has no messages (empty or unknown session id).`);
        const out = msgs.map((m) => {
          const c = (m.content || "").slice(0, 2000);
          if (m.role === "user") return `**User:** ${c}`;
          if (m.role === "assistant") {
            const tools = (m.toolCalls ?? []).map((t) => `\`${t.name}\``).join(", ");
            return `**AI:** ${c}${tools ? `\n  _(tools: ${tools})_` : ""}`;
          }
          return `_${m.role}:_ ${(m.content || "").slice(0, 500)}`;
        });
        const header = data.appName || data.appId ? `Game: **${data.appName || data.appId}**\n\n` : "";
        return txt(`Transcript of \`${session_id}\` (${msgs.length} messages):\n\n${header}${out.join("\n\n")}`);
      },
    );

    // -- admin_send_prompt (org admins: chat into any user's session as them) --
    this.safeTool(
      "admin_send_prompt",
      "PLATFORM ADMINS (org members) ONLY: send a prompt INTO any user's VibeCode session ON THEIR BEHALF — the platform agent runs the turn in their session with their key (auto-picked server-side), and the message lands in their transcript as if they typed it. Streams up to ~110s of progress, then the turn continues server-side; follow with admin_session_history. Non-admins get 403.",
      {
        session_id: z.string().describe("VibeCode session id (any user's, from admin_list_sessions)"),
        prompt: z.string().describe("What to ask the agent to do, in plain English"),
        provider: z.enum(["anthropic", "openai", "google", "github"]).optional().describe("Override provider — default: whatever the session owner can use (vault key → grant → free tier)"),
      },
      async ({ session_id, prompt, provider }) => {
        const token = this.props.token;
        if (!token) return errText("Not authenticated. Connect with a FGS session token.");
        const roBlock = await requireWritable(this.safety(), "admin_send_prompt", { session_id });
        if (roBlock) return roBlock;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 110_000);
        const trace: string[] = [];
        let timedOut = false;
        try {
          const res = await fetch(`${this.env.AGENT_BASE}/v1/admin/session-chat?id=${encodeURIComponent(session_id)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-FGS-Token": token, Authorization: `Bearer ${token}` },
            body: JSON.stringify({ message: prompt, ...(provider ? { provider } : {}) }),
            signal: ctrl.signal,
          });
          if (res.status === 403) { clearTimeout(timer); return errText("Forbidden — this tool is for platform admins (GitHub org members) only."); }
          if (!res.ok || !res.body) { clearTimeout(timer); return errText(`Admin chat failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 300)}`); }
          const reader = res.body.getReader();
          const dec = new TextDecoder();
          let buf = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const parts = buf.split("\n\n");
            buf = parts.pop() ?? "";
            for (const p of parts) {
              const line = p.split("\n").find((l) => l.startsWith("data: "));
              if (!line) continue;
              try {
                const ev = JSON.parse(line.slice(6));
                if (ev.type === "tool_call") {
                  const tc = JSON.parse(ev.data);
                  trace.push(`tool: ${tc.name}${tc.input?.path ? " " + tc.input.path : tc.input?.id ? " " + tc.input.id : ""}`);
                } else if (ev.type === "deploy_status") {
                  const d = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
                  if (d.phase) trace.push(`deploy: ${d.phase}`);
                } else if (ev.type === "error") {
                  trace.push(`ERROR: ${String(ev.data).slice(0, 300)}`);
                }
              } catch { /* skip malformed event */ }
            }
          }
        } catch (e) {
          if ((e as Error).name === "AbortError") timedOut = true;
          else { clearTimeout(timer); return errText(`Admin chat error: ${String(e).slice(0, 300)}`); }
        } finally {
          clearTimeout(timer);
        }
        const traceTxt = trace.length ? `\n\nTurn trace:\n${trace.map((t) => `- ${t}`).join("\n")}` : "";
        await audit(this.safety(), { tool: "admin_send_prompt", action: "success", input: { session_id }, result: { timedOut, traceSteps: trace.length } });
        return txt(
          (timedOut
            ? `Prompt sent into \`${session_id}\` — the turn is STILL RUNNING server-side (streamed 110s of progress).`
            : `Prompt sent into \`${session_id}\` — turn finished.`) +
            traceTxt +
            `\n\nRead the full transcript with admin_session_history.`,
        );
      },
    );

    // -- delete_game (delete a live game you own) --
    this.safeTool(
      "delete_game",
      "Delete a LIVE game you own: delists it from the store, drops its host route (stops serving at <game_id>.freegamestore.online), and archives its GitHub repo. Frees a creator slot. Ownership is enforced server-side (registry creatorGithub). Irreversible from here. For an in-progress VibeCode draft that never deployed, use discard_session instead.",
      {
        game_id: z.string().describe("Game id / slug, e.g. 'ts-probe'"),
        confirm: z.string().optional().describe("Must equal the game id to confirm permanent deletion."),
        dry_run: z.boolean().optional().describe("Preview only: report what would be deleted without deleting anything (no confirm needed)."),
      },
      async ({ game_id, confirm, dry_run = false }) => {
        const token = this.props.token;
        if (!token) return errText("Not authenticated. Connect with a FGS session token.");
        const roBlock = await requireWritable(this.safety(), "delete_game", { game_id });
        if (roBlock) return roBlock;
        const id = game_id.trim().toLowerCase();
        if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return errText(`Invalid game id: \`${game_id}\`.`);
        if (dry_run) {
          return dryRun(this.safety(), "delete_game", "delete", { game_id: id }, {
            game_id: id,
            wouldDo: ["delist from the store", "drop the host route (stops serving)", "archive the GitHub repo"],
          });
        }
        const confirmBlock = await requireConfirmation(this.safety(), "delete_game", confirm, id, { game_id: id });
        if (confirmBlock) return confirmBlock;
        const result = await fgsDelete(this.env.API_BASE, `/api/games/${id}`, token);
        if (result?.error) {
          const hint = result.status === 401 ? " (your token may be expired — re-connect)"
            : result.status === 403 || /own|permission/i.test(String(result.error)) ? " (you can only delete games you own)"
            : "";
          return errText(`Could not delete \`${id}\`: ${result.error}${result.detail ? ` — ${result.detail}` : ""}${hint}`);
        }
        await audit(this.safety(), { tool: "delete_game", action: "success", input: { game_id: id }, result: { deleted: id } });
        return txt(`Deleted **${id}** — delisted from the store, route dropped, repo archived. A creator slot is now free.`);
      },
    );

    // -- discard_session (remove an in-progress VibeCode draft) --
    this.safeTool(
      "discard_session",
      "Discard an in-progress VibeCode session (a DRAFT that never deployed to a live game). Removes it from your session list. Use list_sessions to find the id. This does NOT delete a published game — for that use delete_game.",
      {
        session_id: z.string().describe("VibeCode session id (from list_sessions)"),
        confirm: z.string().optional().describe("Must equal the session id to confirm discarding the draft."),
        dry_run: z.boolean().optional().describe("Preview only: report what would be discarded without discarding (no confirm needed)."),
      },
      async ({ session_id, confirm, dry_run = false }) => {
        const token = this.props.token;
        if (!token) return errText("Not authenticated. Connect with a FGS session token.");
        const roBlock = await requireWritable(this.safety(), "discard_session", { session_id });
        if (roBlock) return roBlock;
        const id = session_id.trim();
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) return errText(`Invalid session id: \`${session_id}\`.`);
        if (dry_run) {
          return dryRun(this.safety(), "discard_session", "discard", { session_id: id }, { session_id: id, wouldDo: ["remove the draft session from your list"] });
        }
        const confirmBlock = await requireConfirmation(this.safety(), "discard_session", confirm, id, { session_id: id });
        if (confirmBlock) return confirmBlock;
        const result = await fgsDelete(this.env.AGENT_BASE, `/sessions/${id}`, token);
        if (result?.error) return errText(`Could not discard session \`${id}\`: ${result.error}${result.detail ? ` — ${result.detail}` : ""}`);
        await audit(this.safety(), { tool: "discard_session", action: "success", input: { session_id: id }, result: { discarded: id } });
        return txt(`Discarded draft session \`${id}\`.`);
      },
    );

    // -- mcp_audit_log (read your own audit trail) --
    this.safeTool(
      "mcp_audit_log",
      "Read your recent MCP audit events for this account — every write, dry-run, and denied tool action, newest first. Secrets are redacted; entries expire after 90 days. Requires an authenticated FGS session.",
      { limit: z.number().int().min(1).max(200).optional().describe("Max events to return (default 50)") },
      async ({ limit }) => {
        if (!this.props.userId) return errText("Not authenticated — the audit log is keyed to your GitHub login.");
        const events = await listAuditEvents(this.safety(), limit ?? 50);
        if (!events.length) return txt("No audit events recorded for your account yet.");
        return txt(JSON.stringify(events, null, 2));
      },
    );
  }
}

// -- Auth middleware --
// FGS admin sessions are 3-part JWTs (header.payload.sig), HMAC-SHA256 signed
// with the admin's own SESSION_SIGNING_KEY. We don't verify locally — the
// admin API verifies on every call. We just decode the payload for userId context.
/**
 * MCP API handler. OAuthProvider authenticates the request and exposes the
 * caller's props on ctx.props. Because agents@0.0.74's serve() drops ctx.props
 * (see CLAUDE.md), we RPC them into the target DO via setAuth before dispatch.
 */
export class FgsApiHandler extends WorkerEntrypoint<Env> {
  async fetch(request: Request): Promise<Response> {
    const props = (this.ctx as unknown as { props?: McpProps }).props;
    const sessionId = request.headers.get("mcp-session-id");
    if (props?.token && sessionId) {
      try {
        const id = this.env.MCP_OBJECT.idFromName(`streamable-http:${sessionId}`);
        const stub = this.env.MCP_OBJECT.get(id) as unknown as { setAuth(p: McpProps): Promise<void> };
        await stub.setAuth(props);
      } catch {
        /* best effort */
      }
    }
    return FgsMcpAgent.serve("/mcp").fetch(request, this.env, this.ctx);
  }
}

// Best-practice MCP auth via @cloudflare/workers-oauth-provider: it handles
// /token, /register, discovery metadata, the 401 challenge, PKCE, and
// audience-bound tokens. Sign-in is delegated to the auth worker (auth-handler.ts),
// so the MCP needs no GitHub app of its own.
export default new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler: FgsApiHandler as never,
  defaultHandler: authHandler as never,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});
