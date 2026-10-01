import { z } from 'zod';
import { fgsDelete } from '../http.js';
import {
  audit,
  dryRun,
  isReadOnly,
  listAuditEvents,
  requireConfirmation,
  requireWritable,
} from '../safety.js';
import { errText, type RegistrationContext, txt } from './registration.js';

export function registerBuildSessionTools(ctx: RegistrationContext): void {
  // -- agent_build (delegate code-gen to the platform's VibeCode agent) --
  ctx.safeTool(
    'agent_build',
    "Hand a natural-language prompt to the FreeGameStore VibeCode AGENT — the platform's own AI writes the code AND deploys it. By default it uses the AI key saved for your account (the platform's encrypted key vault); pass api_key only to override with a different key. Long-running; builds in the background. Returns session_id — poll agent_status for progress.",
    {
      prompt: z.string().describe('What to build, in plain English. Include a desired game id.'),
      game_id: z
        .string()
        .optional()
        .describe(
          'Existing game to work on: imports its repo into the session (engine-correct guidance + push_update instead of a fresh deploy). Omit when building a brand-new game.',
        ),
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
          'Engine template a BRAND-NEW game session seeds from (default canvas). Ignored when game_id is set or the session already exists.',
        ),
      api_key: z
        .string()
        .optional()
        .describe(
          'Override key. Optional — defaults to the key saved for your account in the vault. Provider must match the saved key (or pass provider).',
        ),
      provider: z
        .enum(['anthropic', 'openai', 'google', 'github', 'openrouter'])
        .optional()
        .describe('AI provider (default anthropic). Must match the saved/override key.'),
      model: z.string().optional().describe('Model id'),
      session_id: z.string().optional().describe('Continue an existing build session'),
      dry_run: z
        .boolean()
        .optional()
        .describe(
          'Preview only: report the resolved session and target without running the agent or deploying.',
        ),
    },
    async ({
      prompt,
      game_id,
      template,
      api_key,
      provider,
      model,
      session_id,
      dry_run = false,
    }) => {
      const token = ctx.session.token;
      if (!token) return errText('Not authenticated. Connect with a FGS session token.');
      const roBlock = await requireWritable(ctx.safetyCtx, 'agent_build', { game_id, template });
      if (roBlock) return roBlock;
      const prov = provider ?? 'anthropic';
      const defaultModel: Record<string, string> = {
        anthropic: 'claude-sonnet-4-6',
        openai: 'gpt-4o',
        google: 'gemini-2.5-flash',
        github: 'openai/gpt-4o',
        openrouter: 'anthropic/claude-sonnet-4',
      };
      const prefix = ctx.sessionPrefix(ctx.session.userId);
      const sid = session_id
        ? session_id.startsWith(prefix)
          ? session_id
          : prefix + session_id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)
        : prefix + crypto.randomUUID().slice(0, 12);
      if (dry_run) {
        return dryRun(
          ctx.safetyCtx,
          'agent_build',
          game_id ? 'edit' : 'build',
          { prompt, game_id, template, provider: prov },
          {
            session_id: sid,
            provider: prov,
            model: model ?? defaultModel[prov] ?? 'claude-sonnet-4-6',
            target: game_id ?? '(new game)',
            note: 'Would run one VibeCode agent turn and deploy; nothing is written in dry-run.',
          },
        );
      }
      // Bind the session to an existing game BEFORE the first turn: /import
      // loads the repo's committed files into the session, so the agent gets
      // engine-correct guidance (detectEngine reads web/package.json) and
      // push_update targets the real game instead of dead-ending on "ID taken".
      if (game_id) {
        const imp = await fetch(`${ctx.env.AGENT_BASE}/session/${sid}/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ id: game_id }),
        });
        if (!imp.ok) {
          return errText(
            `Could not open "${game_id}" in the session (${imp.status}): ${(await imp.text()).slice(0, 300)}`,
          );
        }
      }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 110_000);
      const phases: string[] = [];
      let gameId: string | null = null;
      let timedOut = false;
      try {
        const res = await fetch(`${ctx.env.AGENT_BASE}/session/${sid}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          // Omit apiKey when not overridden so the agent resolves the account's
          // vault key server-side (session.ts: aiConfig.apiKey || resolveUserKey).
          body: JSON.stringify({
            message: prompt,
            aiConfig: {
              provider: prov,
              model: model ?? defaultModel[prov] ?? 'claude-sonnet-4-6',
              ...(api_key ? { apiKey: api_key } : {}),
            },
            ...(template && !game_id ? { engine: template } : {}),
          }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          clearTimeout(timer);
          return errText(`Agent chat failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const parts = buf.split('\n\n');
          buf = parts.pop() ?? '';
          for (const p of parts) {
            const line = p.split('\n').find((l) => l.startsWith('data: '));
            if (!line) continue;
            try {
              const ev = JSON.parse(line.slice(6));
              if ((ev.type === 'deploy' || ev.type === 'deploy_status') && ev.data) {
                try {
                  const d = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
                  if (d.phase) phases.push(d.phase);
                  if (d.appId) gameId = d.appId;
                } catch {
                  /* */
                }
              }
              if (ev.appId) gameId = ev.appId;
            } catch {
              /* */
            }
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          timedOut = true;
        } else {
          clearTimeout(timer);
          return errText(`Agent request failed: ${String(err)}`);
        }
      }
      clearTimeout(timer);
      const last = phases[phases.length - 1];
      const liveLine = gameId ? `Live (when built): https://${gameId}.freegamestore.online` : '';
      await audit(ctx.safetyCtx, {
        tool: 'agent_build',
        action: 'success',
        input: { prompt, game_id },
        result: { session_id: sid, gameId, lastPhase: last, timedOut },
      });
      return txt(
        `${timedOut ? 'Agent still building' : 'Agent turn finished'} (session \`${sid}\`).\n` +
          (gameId ? `Game: **${gameId}**\n` : '') +
          (last ? `Last deploy phase: ${last}\n` : '') +
          `${liveLine}\n\nPoll \`agent_status\` with session_id="${sid}" for progress + the live URL.`,
      );
    },
  );

  // -- edit_game (open an EXISTING game in VibeCode; always re-syncs the repo) --
  ctx.safeTool(
    'edit_game',
    "Open one of YOUR existing games in VibeCode and (optionally) tell the agent what to change. Imports the game's CURRENT repo files into a session — so it ALWAYS picks up changes made directly (update_files / git / the web console) since last time — then, if you pass a prompt + api_key, the platform's agent edits and redeploys via push_update (files it doesn't touch are preserved). Direct editing (update_files) and VibeCode are two ways to work on the SAME game; this is the VibeCode entry point for an existing one. Ownership-gated. Returns a session_id — poll agent_status.",
    {
      game_id: z.string().describe("The id/slug of a game you own, e.g. 'kart-racers'"),
      prompt: z
        .string()
        .optional()
        .describe('What to change, in plain English. Omit to just open/sync without editing.'),
      api_key: z
        .string()
        .optional()
        .describe(
          'Override key. Optional — defaults to the key saved for your account in the vault.',
        ),
      provider: z
        .enum(['anthropic', 'openai', 'google', 'github', 'openrouter'])
        .optional()
        .describe('AI provider (default anthropic). Must match the saved/override key.'),
      model: z.string().optional().describe('Model id'),
      dry_run: z
        .boolean()
        .optional()
        .describe(
          'Preview only: report what would be imported/edited without touching the session or the repo.',
        ),
    },
    async ({ game_id, prompt, api_key, provider, model, dry_run = false }) => {
      const token = ctx.session.token;
      if (!token) return errText('Not authenticated. Connect with a FGS session token.');
      const roBlock = await requireWritable(ctx.safetyCtx, 'edit_game', { game_id });
      if (roBlock) return roBlock;
      const gid = game_id.trim().toLowerCase();
      if (!/^[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/.test(gid))
        return errText(`Invalid game id: \`${game_id}\`.`);
      // Preview BEFORE the import: edit_game re-syncs the session from repo
      // HEAD, and with a prompt it also has the agent edit and redeploy via
      // push_update. Both are writes, so a dry run has to stop short of the
      // import rather than merely short of the prompt.
      if (dry_run) {
        return dryRun(
          ctx.safetyCtx,
          'edit_game',
          prompt ? 'edit' : 'import',
          { game_id: gid, hasPrompt: !!prompt },
          {
            game_id: gid,
            wouldDo: prompt
              ? [
                  "re-import the game's current repo files into your VibeCode session",
                  'run the agent with your prompt',
                  'redeploy via push_update (untouched files preserved)',
                ]
              : ["re-import the game's current repo files into your VibeCode session"],
          },
        );
      }

      // Deterministic session per (user, game): reopening continues the same
      // VibeCode conversation. Kept ≤64 chars (agent route cap) and prefixed so
      // agent_status accepts it.
      const prefix = ctx.sessionPrefix(ctx.session.userId);
      const sid = `${prefix}g-${gid}`.slice(0, 64);

      // 1) Import / re-sync from the repo HEAD (ownership enforced server-side).
      const imp = await fetch(`${ctx.env.AGENT_BASE}/session/${sid}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: gid }),
      });
      const impData = (await imp.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        name?: string;
        appUrl?: string;
        fileCount?: number;
        unchanged?: boolean;
      };
      if (!imp.ok || !impData.ok) {
        const hint =
          imp.status === 403
            ? ' (you can only edit games you own)'
            : imp.status === 404
              ? ' (no such game)'
              : '';
        return errText(`Couldn't open \`${gid}\`: ${impData.error || `HTTP ${imp.status}`}${hint}`);
      }
      const name = impData.name || gid;
      const appUrl = impData.appUrl || `https://${gid}.freegamestore.online`;

      // 2) Register in the D1 session index so it shows in list_sessions + the
      //    web console (the DO doesn't write D1 itself).
      await fetch(`${ctx.env.AGENT_BASE}/sessions/${sid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-FGS-Token': token },
        body: JSON.stringify({ title: name, gameId: gid, gameUrl: appUrl, deployed: true }),
      }).catch(() => {});

      const opened = `Opened **${name}** (\`${gid}\`) in VibeCode — ${impData.fileCount ?? '?'} file(s) ${impData.unchanged ? 'already in sync' : 'synced'} from the repo. Session \`${sid}\`.`;
      if (!prompt)
        return txt(
          `${opened}\n\nCall edit_game again with a \`prompt\` to have the agent make changes (it uses your saved key), or use update_files to edit directly.`,
        );

      // 3) Run one agent turn (same streaming contract as agent_build).
      const prov = provider ?? 'anthropic';
      const defaultModel: Record<string, string> = {
        anthropic: 'claude-sonnet-4-6',
        openai: 'gpt-4o',
        google: 'gemini-2.5-flash',
        github: 'openai/gpt-4o',
        openrouter: 'anthropic/claude-sonnet-4',
      };
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 110_000);
      const phases: string[] = [];
      let timedOut = false;
      try {
        const res = await fetch(`${ctx.env.AGENT_BASE}/session/${sid}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          // Omit apiKey when not overridden → agent uses the account vault key.
          body: JSON.stringify({
            message: prompt,
            aiConfig: {
              provider: prov,
              model: model ?? defaultModel[prov] ?? 'claude-sonnet-4-6',
              ...(api_key ? { apiKey: api_key } : {}),
            },
          }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          clearTimeout(timer);
          return errText(
            `${opened}\n\nAgent edit failed (${res.status}): ${(await res.text()).slice(0, 300)}`,
          );
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const parts = buf.split('\n\n');
          buf = parts.pop() ?? '';
          for (const p of parts) {
            const line = p.split('\n').find((l) => l.startsWith('data: '));
            if (!line) continue;
            try {
              const ev = JSON.parse(line.slice(6));
              if ((ev.type === 'deploy' || ev.type === 'deploy_status') && ev.data) {
                const d = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
                if (d.phase) phases.push(d.phase);
              }
            } catch {
              /* non-JSON keepalive */
            }
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') timedOut = true;
        else {
          clearTimeout(timer);
          return errText(`${opened}\n\nAgent request failed: ${String(err)}`);
        }
      }
      clearTimeout(timer);
      const last = phases[phases.length - 1];
      await audit(ctx.safetyCtx, {
        tool: 'edit_game',
        action: 'success',
        input: { game_id: gid, hasPrompt: !!prompt },
        result: { session_id: sid, lastPhase: last, timedOut },
      });
      return txt(
        `${opened}\n\n${timedOut ? 'Agent still working' : 'Agent turn finished'}.\n` +
          (last ? `Last deploy phase: ${last}\n` : '') +
          `Live: ${appUrl}\n\nPoll \`agent_status\` with session_id="${sid}" for progress.`,
      );
    },
  );

  // -- agent_status --
  ctx.safeTool(
    'agent_status',
    'Check a VibeCode agent build session (started with agent_build): the game id, deploy phase, and live URL.',
    { session_id: z.string().describe('The session_id returned by agent_build') },
    async ({ session_id }) => {
      const token = ctx.session.token;
      if (!token) return errText('Not authenticated. Connect with a FGS session token.');
      if (!session_id.startsWith(ctx.sessionPrefix(ctx.session.userId)))
        return errText(
          "That session isn't one of yours — agent sessions are scoped to your account.",
        );
      const res = await fetch(`${ctx.env.AGENT_BASE}/session/${session_id}/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return errText(`Status fetch failed (${res.status}).`);
      let s: {
        appId?: string | null;
        appUrl?: string | null;
        deployStatus?: { phase?: string; error?: string } | null;
        messageCount?: number;
      };
      try {
        s = (await res.json()) as typeof s;
      } catch {
        return errText('Agent status returned invalid JSON.');
      }
      const lines = [
        `Session **${session_id}**`,
        `Game: ${s.appId ?? '(not deployed yet)'}`,
        `Deploy phase: ${s.deployStatus?.phase ?? '—'}${s.deployStatus?.error ? ` (error: ${s.deployStatus.error.slice(0, 200)})` : ''}`,
        s.appUrl
          ? `Live: ${s.appUrl}`
          : s.appId
            ? `URL (once live): https://${s.appId}.freegamestore.online`
            : '',
        `Messages: ${s.messageCount ?? 0}`,
      ].filter(Boolean);
      return txt(lines.join('\n'));
    },
  );

  // -- whoami (the authenticated user, straight from the OAuth props) --
  ctx.safeTool(
    'whoami',
    "Show who you're authenticated as on the FreeGameStore MCP — your GitHub login and token identity.",
    {},
    async () => {
      const login = ctx.session.userId;
      const token = ctx.session.token;
      if (!login && !token)
        return errText('Not authenticated — no session on this MCP connection.');
      let claims = '';
      if (token) {
        try {
          const p = token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/');
          const payload = JSON.parse(atob(p + '==='.slice(0, (4 - (p.length % 4)) % 4))) as {
            sub?: string;
            name?: string;
            login?: string;
            exp?: number;
          };
          const exp = payload.exp ? new Date(payload.exp * 1000).toISOString() : '—';
          claims = `\n- login: ${payload.login ?? '—'}\n- name: ${payload.name ?? '—'}\n- sub: ${payload.sub ?? '—'}\n- token expires: ${exp}`;
        } catch {
          /* unsigned read, best effort */
        }
      }
      const ro = isReadOnly(ctx.env)
        ? '\n\n**Read-only mode is ON** (MCP_READ_ONLY=1) — every write tool is disabled; reads and dry-runs still work.'
        : '';
      return txt(`You are authenticated as **${login ?? '(unknown)'}**.${claims}${ro}`);
    },
  );

  // -- list_sessions (your VibeCode sessions from the web console) --
  ctx.safeTool(
    'list_sessions',
    "List YOUR VibeCode sessions from the web console — title, game, last updated. These are the chats where you built games with the platform's AI. Use session_history to read a transcript.",
    {},
    async () => {
      const token = ctx.session.token;
      if (!token) return errText('Not authenticated. Connect with a FGS session token.');
      const res = await fetch(`${ctx.env.AGENT_BASE}/sessions`, {
        headers: { 'X-FGS-Token': token },
      });
      if (!res.ok)
        return errText(
          `Could not list sessions (${res.status}). Your VibeCode session list isn't reachable yet — use session_history with a session id (from a console.freegamestore.online/create/<id> URL) to read a specific chat.`,
        );
      let data: {
        sessions?: Array<{
          id: string;
          name: string;
          gameId?: string;
          deployed?: boolean;
          createdAt?: string;
        }>;
      };
      try {
        data = (await res.json()) as typeof data;
      } catch {
        return errText('Sessions returned invalid JSON.');
      }
      const sessions = data.sessions ?? [];
      if (!sessions.length) {
        return txt(
          "No VibeCode sessions found server-side yet. Open console.freegamestore.online once while signed in to sync your existing sessions, then try again. (Old sessions live only in that browser's storage until synced.) You can also read any session directly with session_history if you have its id.",
        );
      }
      const lines = sessions.map(
        (s, i) =>
          `${i + 1}. **${s.name || 'Untitled'}** — \`${s.id}\`${s.gameId ? ` · game: ${s.gameId}` : ''}${s.deployed ? ' · deployed' : ''}${s.createdAt ? ` · ${s.createdAt}` : ''}`,
      );
      return txt(
        `${sessions.length} VibeCode session(s), newest first:\n\n${lines.join('\n')}\n\nUse session_history with a session id to read the chat.`,
      );
    },
  );

  // -- session_history (read a VibeCode chat transcript) --
  ctx.safeTool(
    'session_history',
    "Read the full chat transcript of a VibeCode session by id (from list_sessions, or a console.freegamestore.online/create/<id> URL) — the conversation between you and the platform's AI game builder.",
    { session_id: z.string().describe('VibeCode session id') },
    async ({ session_id }) => {
      const token = ctx.session.token;
      if (!token) return errText('Not authenticated. Connect with a FGS session token.');
      // The agent worker gates every /session/* route — without the token this
      // always 401'd. resolveUser accepts a Bearer token.
      const res = await fetch(
        `${ctx.env.AGENT_BASE}/session/${encodeURIComponent(session_id)}/history`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!res.ok) return errText(`Could not fetch history (${res.status}).`);
      let data: {
        messages?: Array<{ role: string; content?: string; toolCalls?: Array<{ name: string }> }>;
        appId?: string | null;
        appName?: string | null;
      };
      try {
        data = (await res.json()) as typeof data;
      } catch {
        return errText('History returned invalid JSON.');
      }
      const msgs = data.messages ?? [];
      if (!msgs.length)
        return txt(`Session \`${session_id}\` has no messages (empty or unknown session id).`);
      const out = msgs.map((m) => {
        const c = (m.content || '').slice(0, 2000);
        if (m.role === 'user') return `**You:** ${c}`;
        if (m.role === 'assistant') {
          const tools = (m.toolCalls ?? []).map((t) => `\`${t.name}\``).join(', ');
          return `**AI:** ${c}${tools ? `\n  _(tools: ${tools})_` : ''}`;
        }
        return `_${m.role}:_ ${(m.content || '').slice(0, 500)}`;
      });
      const header =
        data.appName || data.appId ? `Game: **${data.appName || data.appId}**\n\n` : '';
      return txt(
        `Transcript of \`${session_id}\` (${msgs.length} messages):\n\n${header}${out.join('\n\n')}`,
      );
    },
  );

  // -- delete_game (delete a live game you own) --
  ctx.safeTool(
    'delete_game',
    'Delete a LIVE game you own: delists it from the store, drops its host route (stops serving at <game_id>.freegamestore.online), and archives its GitHub repo. Frees a creator slot. Ownership is enforced server-side (registry creatorGithub). Irreversible from here. For an in-progress VibeCode draft that never deployed, use discard_session instead.',
    {
      game_id: z.string().describe("Game id / slug, e.g. 'ts-probe'"),
      confirm: z
        .string()
        .optional()
        .describe('Must equal the game id to confirm permanent deletion.'),
      dry_run: z
        .boolean()
        .optional()
        .describe(
          'Preview only: report what would be deleted without deleting anything (no confirm needed).',
        ),
    },
    async ({ game_id, confirm, dry_run = false }) => {
      const token = ctx.session.token;
      if (!token) return errText('Not authenticated. Connect with a FGS session token.');
      const roBlock = await requireWritable(ctx.safetyCtx, 'delete_game', { game_id });
      if (roBlock) return roBlock;
      const id = game_id.trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return errText(`Invalid game id: \`${game_id}\`.`);
      if (dry_run) {
        return dryRun(
          ctx.safetyCtx,
          'delete_game',
          'delete',
          { game_id: id },
          {
            game_id: id,
            wouldDo: [
              'delist from the store',
              'drop the host route (stops serving)',
              'archive the GitHub repo',
            ],
          },
        );
      }
      const confirmBlock = await requireConfirmation(ctx.safetyCtx, 'delete_game', confirm, id, {
        game_id: id,
      });
      if (confirmBlock) return confirmBlock;
      const result = await fgsDelete(ctx.env.API_BASE, `/api/games/${id}`, token);
      if (result?.error) {
        const hint =
          result.status === 401
            ? ' (your token may be expired — re-connect)'
            : result.status === 403 || /own|permission/i.test(String(result.error))
              ? ' (you can only delete games you own)'
              : '';
        return errText(
          `Could not delete \`${id}\`: ${result.error}${result.detail ? ` — ${result.detail}` : ''}${hint}`,
        );
      }
      // Delisting is the durable first step, while route cleanup, archival,
      // and session-index purging are best-effort. The admin API returns its
      // per-step outcome even when that primary operation succeeded; never
      // tell the caller every resource was removed if one of those steps
      // failed.
      const failedSteps = Array.isArray((result as { steps?: unknown }).steps)
        ? (
            result as { steps: Array<{ name?: unknown; detail?: unknown; status?: unknown }> }
          ).steps.filter((step) => step.status === 'fail')
        : [];
      if (failedSteps.length) {
        const details = failedSteps
          .map((step) => `${String(step.name ?? 'cleanup')}: ${String(step.detail ?? 'failed')}`)
          .join('; ');
        await audit(ctx.safetyCtx, {
          tool: 'delete_game',
          action: 'partial',
          input: { game_id: id },
          result: { deleted: id, failedSteps: failedSteps.length },
        });
        return errText(
          `Deleted **${id}** from the store, but cleanup was incomplete: ${details}. Retry deletion or contact an administrator.`,
        );
      }
      await audit(ctx.safetyCtx, {
        tool: 'delete_game',
        action: 'success',
        input: { game_id: id },
        result: { deleted: id },
      });
      return txt(
        `Deleted **${id}** — delisted from the store, route dropped, repo archived. A creator slot is now free.`,
      );
    },
  );

  // -- discard_session (remove an in-progress VibeCode draft) --
  ctx.safeTool(
    'discard_session',
    'Discard an in-progress VibeCode session (a DRAFT that never deployed to a live game). Removes it from your session list. Use list_sessions to find the id. This does NOT delete a published game — for that use delete_game.',
    {
      session_id: z.string().describe('VibeCode session id (from list_sessions)'),
      confirm: z
        .string()
        .optional()
        .describe('Must equal the session id to confirm discarding the draft.'),
      dry_run: z
        .boolean()
        .optional()
        .describe(
          'Preview only: report what would be discarded without discarding (no confirm needed).',
        ),
    },
    async ({ session_id, confirm, dry_run = false }) => {
      const token = ctx.session.token;
      if (!token) return errText('Not authenticated. Connect with a FGS session token.');
      const roBlock = await requireWritable(ctx.safetyCtx, 'discard_session', { session_id });
      if (roBlock) return roBlock;
      const id = session_id.trim();
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id))
        return errText(`Invalid session id: \`${session_id}\`.`);
      if (dry_run) {
        return dryRun(
          ctx.safetyCtx,
          'discard_session',
          'discard',
          { session_id: id },
          { session_id: id, wouldDo: ['remove the draft session from your list'] },
        );
      }
      const confirmBlock = await requireConfirmation(
        ctx.safetyCtx,
        'discard_session',
        confirm,
        id,
        { session_id: id },
      );
      if (confirmBlock) return confirmBlock;
      const result = await fgsDelete(ctx.env.AGENT_BASE, `/sessions/${id}`, token);
      if (result?.error)
        return errText(
          `Could not discard session \`${id}\`: ${result.error}${result.detail ? ` — ${result.detail}` : ''}`,
        );
      await audit(ctx.safetyCtx, {
        tool: 'discard_session',
        action: 'success',
        input: { session_id: id },
        result: { discarded: id },
      });
      return txt(`Discarded draft session \`${id}\`.`);
    },
  );

  // -- mcp_audit_log (read your own audit trail) --
  ctx.safeTool(
    'mcp_audit_log',
    'Read your recent MCP audit events for this account — every write, dry-run, and denied tool action, newest first. Secrets are redacted; entries expire after 90 days. Requires an authenticated FGS session.',
    {
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe('Max events to return (default 50)'),
    },
    async ({ limit }) => {
      if (!ctx.session.userId)
        return errText('Not authenticated — the audit log is keyed to your GitHub login.');
      const events = await listAuditEvents(ctx.safetyCtx, limit ?? 50);
      if (!events.length) return txt('No audit events recorded for your account yet.');
      return txt(JSON.stringify(events, null, 2));
    },
  );
}
