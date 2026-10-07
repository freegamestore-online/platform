import { z } from 'zod';
import { safeFetch, withTimeout } from '../http.js';
import { audit, dryRun, requireConfirmation, requireWritable } from '../safety.js';
import { errText, type RegistrationContext, txt } from './registration.js';

export function registerAdminTools(ctx: RegistrationContext): void {
  // -- admin_list_sessions (org admins: every user's sessions) --
  ctx.safeTool(
    'admin_list_sessions',
    "PLATFORM ADMINS (org members) ONLY: list EVERY user's VibeCode sessions across the platform — who built what, token spend, last activity. Pair with admin_session_history to read any transcript. Non-admins get 403.",
    {},
    async () => {
      const token = ctx.session.token;
      if (!token) return errText('Not authenticated. Connect with a FGS session token.');
      const res = await withTimeout((signal) =>
        fetch(`${ctx.env.AGENT_BASE}/admin/sessions`, {
          headers: { 'X-FGS-Token': token, Authorization: `Bearer ${token}` },
          signal,
        }),
      );
      if (res.status === 403)
        return errText('Forbidden — this tool is for platform admins (GitHub org members) only.');
      if (!res.ok) return errText(`Could not list sessions (${res.status}).`);
      let data: {
        sessions?: Array<{
          id: string;
          user: string;
          name: string;
          gameId?: string;
          deployed?: boolean;
          tokens?: { input: number; output: number };
          updatedAt?: string;
        }>;
      };
      try {
        data = (await res.json()) as typeof data;
      } catch {
        return errText('Admin sessions returned invalid JSON.');
      }
      const sessions = data.sessions ?? [];
      if (!sessions.length) return txt('No sessions recorded on the platform yet.');
      const lines = sessions.map(
        (s, i) =>
          `${i + 1}. **${s.name || 'Untitled'}** by \`${s.user}\` — \`${s.id}\`${s.gameId ? ` · game: ${s.gameId}` : ''}${s.deployed ? ' · deployed' : ' · draft'}${s.updatedAt ? ` · ${s.updatedAt}` : ''}`,
      );
      return txt(
        `${sessions.length} session(s) platform-wide, newest first:\n\n${lines.join('\n')}\n\nUse admin_session_history with a session id to read any chat.`,
      );
    },
  );

  // -- admin_session_history (org admins: read anyone's transcript) --
  ctx.safeTool(
    'admin_session_history',
    "PLATFORM ADMINS (org members) ONLY: read the full chat transcript of ANY user's VibeCode session by id (from admin_list_sessions). Read-only. Non-admins get 403.",
    { session_id: z.string().describe("VibeCode session id (any user's)") },
    async ({ session_id }) => {
      const token = ctx.session.token;
      if (!token) return errText('Not authenticated. Connect with a FGS session token.');
      // ?admin=1 asks the agent worker to verify org membership and pass the
      // read-only admin flag to the session DO (bypasses the ownership gate
      // for GET history/status only).
      const res = await withTimeout((signal) =>
        fetch(`${ctx.env.AGENT_BASE}/session/${encodeURIComponent(session_id)}/history?admin=1`, {
          headers: { 'X-FGS-Token': token, Authorization: `Bearer ${token}` },
          signal,
        }),
      );
      if (res.status === 403)
        return errText(
          "Forbidden — you don't own this session and aren't a platform admin (org member).",
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
        if (m.role === 'user') return `**User:** ${c}`;
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

  // -- admin_send_prompt (org admins: chat into any user's session as them) --
  ctx.safeTool(
    'admin_send_prompt',
    "PLATFORM ADMINS (org members) ONLY: send a prompt INTO any user's VibeCode session ON THEIR BEHALF — the platform agent runs the turn in their session with their key (auto-picked server-side), and the message lands in their transcript as if they typed it. Streams up to ~110s of progress, then the turn continues server-side; follow with admin_session_history. Non-admins get 403.",
    {
      session_id: z.string().describe("VibeCode session id (any user's, from admin_list_sessions)"),
      prompt: z.string().describe('What to ask the agent to do, in plain English'),
      provider: z
        .enum(['anthropic', 'openai', 'google', 'github'])
        .optional()
        .describe(
          'Override provider — default: whatever the session owner can use (vault key → grant → free tier)',
        ),
      confirm: z
        .string()
        .optional()
        .describe(
          "Must equal the session_id. Required: this writes into ANOTHER user's session and spends their key.",
        ),
      dry_run: z
        .boolean()
        .optional()
        .describe(
          'Preview only: report whose session would be written to, without sending anything (no confirm needed).',
        ),
    },
    async ({ session_id, prompt, provider, confirm, dry_run = false }) => {
      const token = ctx.session.token;
      if (!token) return errText('Not authenticated. Connect with a FGS session token.');
      const roBlock = await requireWritable(ctx.safetyCtx, 'admin_send_prompt', { session_id });
      if (roBlock) return roBlock;
      // This is the most consequential write on the server: it runs an agent
      // turn inside SOMEONE ELSE'S session, spends their key, and the message
      // lands in their transcript as if they typed it. delete_game requires a
      // confirm token to archive a repo the caller already owns; acting as
      // another user warrants at least the same. Both gates sit ahead of the
      // fetch so neither a preview nor an unconfirmed call reaches the agent.
      if (dry_run) {
        return dryRun(
          ctx.safetyCtx,
          'admin_send_prompt',
          'send',
          { session_id, hasPrompt: !!prompt },
          {
            session_id,
            wouldDo: [
              "run an agent turn inside this user's session, as them",
              "spend the session owner's AI key",
              'append the prompt + reply to their transcript',
            ],
          },
        );
      }
      const confirmBlock = await requireConfirmation(
        ctx.safetyCtx,
        'admin_send_prompt',
        confirm,
        session_id,
        { session_id },
      );
      if (confirmBlock) return confirmBlock;
      const trace: string[] = [];
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 110_000);
      let timedOut = false;

      try {
        // Custom stream handler for admin_send_prompt (includes tool_call and error events)
        const res = await safeFetch('/v1/admin/session-chat', (signal) =>
          fetch(
            `${ctx.env.AGENT_BASE}/v1/admin/session-chat?id=${encodeURIComponent(session_id)}`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-FGS-Token': token,
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ message: prompt, ...(provider ? { provider } : {}) }),
              signal,
            },
          ),
        );
        if ('error' in res) {
          return errText(`Admin chat error: ${res.error}`);
        }
        if (res.res.status === 403) {
          return errText('Forbidden — this tool is for platform admins (GitHub org members) only.');
        }
        if (!res.res.ok || !res.res.body) {
          const text = await res.res.text().catch(() => '');
          return errText(
            `Admin chat failed (${res.res.status}): ${text.slice(0, 300)}`,
          );
        }

        const reader = res.res.body.getReader();
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
              if (ev.type === 'tool_call') {
                const tc = JSON.parse(ev.data);
                trace.push(
                  `tool: ${tc.name}${tc.input?.path ? ` ${tc.input.path}` : tc.input?.id ? ` ${tc.input.id}` : ''}`,
                );
              } else if (ev.type === 'deploy_status') {
                const d = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
                if (d.phase) trace.push(`deploy: ${d.phase}`);
              } else if (ev.type === 'error') {
                trace.push(`ERROR: ${String(ev.data).slice(0, 300)}`);
              }
            } catch {
              /* skip malformed event */
            }
          }
        }
      } catch (e) {
        if ((e as Error).name === 'AbortError') timedOut = true;
        else {
          return errText(`Admin chat error: ${String(e).slice(0, 300)}`);
        }
      } finally {
        clearTimeout(timer);
      }
      const traceTxt = trace.length
        ? `\n\nTurn trace:\n${trace.map((t) => `- ${t}`).join('\n')}`
        : '';
      await audit(ctx.safetyCtx, {
        tool: 'admin_send_prompt',
        action: 'success',
        input: { session_id },
        result: { timedOut, traceSteps: trace.length },
      });
      return txt(
        (timedOut
          ? `Prompt sent into \`${session_id}\` — the turn is STILL RUNNING server-side (streamed 110s of progress).`
          : `Prompt sent into \`${session_id}\` — turn finished.`) +
          traceTxt +
          `\n\nRead the full transcript with admin_session_history.`,
      );
    },
  );
}
