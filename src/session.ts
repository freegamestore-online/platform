/** Durable Object: one instance per agent session.
 *  Stores conversation history, virtual filesystem, token usage, deploy status. */

import { runAgentTurn } from "./agent";
import type { StoreConfig } from "./config";
import { getConfig } from "./config";
import { fetchRepoFiles, fetchRepoHeadSha, fetchTemplateSeed, type DeployEnv, type DeployStatus } from "./deploy";
import type { Env } from "./index";
import { executeInfraTool } from "./infra-exec";
import { ownsGame } from "./ownership";
import type { AIConfig, Message, TokenUsage } from "./providers/types";
import { type PushSubscription, sendWebPush } from "./push";
import { getTemplateFiles } from "./template";
import { resolveUserKey } from "./keys";
import { allowRequest } from "./ratelimit";
import { upsertSessionIndex } from "./sessions";

interface ErrorEntry {
  timestamp: string;
  source: string;
  message: string;
}

interface DeployLogEntry {
  timestamp: string;
  phase: string;
  detail: string;
}

interface SessionState {
  messages: Message[];
  files: Record<string, string>;
  /** The template snapshot the session was seeded from (template-game-canvas for
   *  FGS games), used as the delta baseline at deploy. Absent on legacy sessions
   *  and sessions seeded from the bundled inline template (fetch fallback). */
  seed?: Record<string, string>;
  tokenUsage: TokenUsage;
  deployStatus: DeployStatus | null;
  /** Append-only timeline of deploy phases (provisioning → pushing → building →
   *  live/error), so a stuck or failed deploy can be diagnosed after the fact —
   *  `deployStatus` only ever holds the latest snapshot. Capped at MAX_DEPLOY_LOG. */
  deployLog: DeployLogEntry[];
  appId: string | null;
  appName: string | null;
  /** The repo commit SHA the session's files were last imported from (set when
   *  opening an existing game). Lets a re-open skip the tree+blob walk when the
   *  repo hasn't changed, and forces a re-sync when it HAS (e.g. someone edited
   *  the repo directly via update_files/git between VibeCode sessions). */
  importedSha?: string;
  errors: ErrorEntry[];
}

// Bound unbounded growth in long-lived Durable Objects. A session that keeps
// getting messages/deploys forever would grow its stored blob without limit.
const MAX_MESSAGES = 400;
const MAX_ERRORS = 50;
const MAX_DEPLOY_LOG = 200;

/** One-line human summary of a deploy status snapshot for the timeline log. */
function deployStatusDetail(status: DeployStatus): string {
  switch (status.phase) {
    case "provisioning": {
      const last = status.steps[status.steps.length - 1];
      return last ? `${last.name}: ${last.status}` : "Starting…";
    }
    case "live":
      return `Live at ${status.appUrl}`;
    case "error":
      return status.error;
    default:
      return status.phase;
  }
}

export class AgentSession implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private config: StoreConfig;
  private session: SessionState | null = null;
  /** Guards against two overlapping /chat turns on the same session. Both run as
   *  background async tasks that mutate `session` across await points, so without
   *  this the second turn would interleave and clobber the first's writes. */
  private chatInProgress = false;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.config = getConfig(env.STORE);
  }

  private async load(seedIfMissing = true): Promise<SessionState> {
    if (this.session) return this.session;
    const stored = await this.state.storage.get<SessionState>("session");
    if (stored) {
      this.session = stored;
    } else if (seedIfMissing) {
      this.session = await this.freshSession();
      await this.save();
    } else {
      // Read-only route on an unused session id: return a transient empty view
      // WITHOUT the ~25-call GitHub template seed or a write. Not cached, so a
      // later /chat still seeds it properly. Closes the abuse vector where an
      // authed user iterates session ids and storms the shared PAT via GET
      // /status|/history|/files.
      return this.emptySession();
    }
    // Migrate old sessions missing newer fields.
    if (!this.session.errors) this.session.errors = [];
    if (!this.session.deployLog) this.session.deployLog = [];
    return this.session;
  }

  /** An unseeded, unsaved session view — for read routes touching a session id
   *  that has never been used. No template fetch, no storage write. */
  private emptySession(): SessionState {
    return {
      messages: [],
      files: {},
      tokenUsage: { input: 0, output: 0 },
      deployStatus: null,
      deployLog: [],
      appId: null,
      appName: null,
      errors: [],
    };
  }

  /** A brand-new session, seeded from the canonical template repo
   *  (template-game-canvas) so the agent authors against the SAME SDK-based
   *  scaffold admin's /generate produces. Falls back to the bundled inline
   *  template if the fetch fails (leaving `seed` undefined → the delta baseline
   *  falls back to the inline template too, staying self-consistent). */
  private async freshSession(): Promise<SessionState> {
    const seed = await fetchTemplateSeed(this.config, this.env.GITHUB_TOKEN);
    return {
      messages: [],
      files: { ...(seed ?? getTemplateFiles(this.config)) },
      seed: seed ?? undefined,
      tokenUsage: { input: 0, output: 0 },
      deployStatus: null,
      deployLog: [],
      appId: null,
      appName: null,
      errors: [],
    };
  }

  private async save(): Promise<void> {
    if (this.session) {
      await this.state.storage.put("session", this.session);
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, this.config.domain) });
    }

    try {
      // Ownership gate. The worker has already verified identity and set
      // X-Auth-User; bind this session to the first authenticated caller
      // (trust-on-first-use) and reject everyone else. Without this, anyone who
      // learns a session id could read its transcript (/history), wipe it
      // (/reset), or drive the agent.
      const caller = request.headers.get("X-Auth-User");
      if (!caller) return json({ error: "unauthorized" }, 401, request, this.config.domain);
      const owner = await this.state.storage.get<string>("owner");
      if (!owner) {
        await this.state.storage.put("owner", caller);
      } else if (owner !== caller) {
        return json({ error: "forbidden" }, 403, request, this.config.domain);
      }

      if (path === "/chat" && request.method === "POST") {
        return this.handleChat(request);
      }
      if (path === "/status" && request.method === "GET") {
        return this.handleStatus(request);
      }
      if (path === "/files" && request.method === "GET") {
        return this.handleListFiles(request);
      }
      if (path === "/history" && request.method === "GET") {
        return this.handleHistory(request);
      }
      if (path === "/errors" && request.method === "GET") {
        return this.handleErrors(request);
      }
      if (path === "/import" && request.method === "POST") {
        return this.handleImport(request);
      }
      if (path === "/reset" && request.method === "POST") {
        return this.handleReset(request);
      }
      if (path === "/push-subscribe" && request.method === "POST") {
        return this.handlePushSubscribe(request);
      }
      return json({ error: "not found" }, 404, request, this.config.domain);
    } catch (err) {
      return json({ error: String(err) }, 500, request, this.config.domain);
    }
  }

  /** POST /chat — stream an agent turn via SSE */
  private async handleChat(request: Request): Promise<Response> {
    if (this.chatInProgress) {
      return json({ error: "A build is already in progress for this game — wait for it to finish." }, 429, request, this.config.domain);
    }
    // Claim the turn SYNCHRONOUSLY, before the first await. A DO interleaves
    // concurrent requests at every await; checking the flag here but setting it
    // only after several awaits (json parse, key decrypt, load) let a
    // double-send / two tabs / a client retry both pass the check and then
    // interleave writes on the shared `session` object — desyncing
    // tool_use/tool_result and bricking the session (the exact failure this
    // guard exists to prevent). Every setup-phase exit below releases it; once
    // the background turn is launched it owns the flag and clears it in finally.
    this.chatInProgress = true;
    try {
    const body = await request.json<{
      message: string;
      aiConfig: AIConfig;
    }>();

    if (!body.message || !body.aiConfig?.provider || !body.aiConfig?.model) {
      this.chatInProgress = false;
      return json(
        { error: "message, aiConfig.provider, and aiConfig.model are required" },
        400,
        request,
        this.config.domain,
      );
    }

    // Resolve the AI key server-side. An explicit key in the request (MCP
    // bring-your-own) wins; otherwise decrypt the signed-in user's key from the
    // encrypted vault (keyed by the worker-verified X-Auth-User). The browser no
    // longer sends the key at all — it never has to hold plaintext.
    const userId = request.headers.get("X-Auth-User") || "";
    let resolvedKey =
      body.aiConfig.apiKey?.trim() ||
      (userId ? await resolveUserKey(this.env, userId, body.aiConfig.provider) : null);
    // GitHub Models is the FREE tier — it still needs a GitHub token, but the
    // user shouldn't have to supply one. Fall back to the platform token so
    // "free" actually works keyless. (A user who saved their own GitHub token
    // still wins above — their per-user rate limit, not the shared one.)
    let usedFreeTier = false;
    if (!resolvedKey && body.aiConfig.provider === "github") {
      resolvedKey = this.env.GITHUB_TOKEN || null;
      usedFreeTier = true;
    }
    if (!resolvedKey) {
      this.chatInProgress = false;
      return json(
        { error: "No API key saved for this provider — add one in AI settings.", code: "no_key" },
        400,
        request,
        this.config.domain,
      );
    }
    body.aiConfig = { ...body.aiConfig, apiKey: resolvedKey };

    // Rate-limit the FREE tier (shared platform token) per user so one scripted
    // loop can't exhaust the shared GitHub Models quota — or crowd out the
    // provisioning PAT — for everyone. Users on their own key are their own
    // quota and aren't limited here.
    if (usedFreeTier && userId) {
      const ok = await allowRequest(this.env.DB, `freechat:${userId}`, 60, 3600, Math.floor(Date.now() / 1000));
      if (!ok) {
        this.chatInProgress = false;
        return json(
          { error: "You've hit the free-tier limit for now. Add your own API key in AI settings for unlimited builds, or try again later.", code: "rate_limited" },
          429,
          request,
          this.config.domain,
        );
      }
    }

    const session = await this.load();
    const files = new Map(Object.entries(session.files));

    // Keep the D1 /sessions index authoritative from the SERVER so this session
    // is discoverable in ANY browser — not dependent on the client's
    // PUT /sessions/:id, which can race or be missed (which made an active chat
    // "vanish" when opened in a second browser). Best-effort; never fail a chat.
    const sessionId = request.headers.get("X-Session-Id") || "";
    if (userId && sessionId) {
      const gameUrl = session.appId ? `https://${session.appId}.${this.config.domain}` : null;
      try {
        await upsertSessionIndex(this.env.DB, userId, sessionId, {
          title: session.appName,
          gameId: session.appId,
          gameUrl,
        });
      } catch {
        /* index is best-effort — discovery convenience, not the transcript */
      }
    }

    // The signed-in creator's GitHub login (worker-verified header), used to add
    // them as a collaborator on the repo the platform bot creates at deploy.
    const creatorLogin = request.headers.get("X-Auth-Login") || undefined;

    const { readable, writable } = new TransformStream<Uint8Array>();
    const writer = writable.getWriter();

    // Build deploy env directly from DO's env bindings (no header passing)
    const deployEnv: DeployEnv | null =
      this.env.GITHUB_TOKEN && this.env.CF_API_TOKEN
        ? {
            GITHUB_TOKEN: this.env.GITHUB_TOKEN,
            CF_API_TOKEN: this.env.CF_API_TOKEN,
            CF_ACCOUNT_ID: this.env.CF_ACCOUNT_ID,
            // Path B (games): register host route + registry via admin.
            ADMIN: this.env.ADMIN,
            INTERNAL_TOKEN: this.env.INTERNAL_TOKEN,
          }
        : null;

    const config = this.config;

    // The turn was already claimed synchronously above (before any await), so a
    // racing /chat can't slip in. From here the background task owns the flag and
    // releases it in its finally.

    // Run the agent in the background
    (async () => {
      const encoder = new TextEncoder();
      const sendSSE = (evt: { type: string; data: string }) => {
        writer.write(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`)).catch(() => {});
      };

      try {
        const sessionCtx = {
          appId: session.appId,
          appName: session.appName,
          fileCount: files.size,
          fileList: [...files.keys()].sort().join(", "),
        };
        const result = await runAgentTurn(body.aiConfig, session.messages, body.message, files, writer, config, sessionCtx).catch(async (err) => {
          this.logError("agent", String(err));
          // Persist the user's message + the failure so the turn survives a
          // reload. Without this, a hard failure (network/provider throw)
          // discarded everything the user typed — it looked like "the chat
          // wasn't preserved". Handled provider errors already persist via
          // newMessages; this covers the throw path.
          session.messages.push(
            { role: "user", content: body.message },
            { role: "assistant", content: `Error: ${String(err)}` },
          );
          await this.save();
          throw err;
        });

        session.messages.push(...result.newMessages);
        if (session.messages.length > MAX_MESSAGES) session.messages = session.messages.slice(-MAX_MESSAGES);
        session.files = Object.fromEntries(files);
        // Accumulate this turn's token usage into the persisted running total
        // so /status and /history report real figures (not {input:0,output:0}).
        session.tokenUsage.input += result.tokenUsage.input;
        session.tokenUsage.output += result.tokenUsage.output;
        await this.save();

        // Execute infra tools server-side and feed results back to agent
        if (result.infraRequests.length > 0) {
          if (!deployEnv) {
            const msg = "Server configuration error: deploy environment not available.";
            this.appendAssistantError("deploy", msg);
            await this.save();
            sendSSE({ type: "error", data: msg });
            sendSSE({ type: "done", data: "" });
            return;
          }

          const infraResults: { id: string; content: string }[] = [];
          for (const req of result.infraRequests) {
            const tc = req.toolCall;
            let toolResult: string;

            try {
              toolResult = await executeInfraTool(tc, {
                appId: session.appId,
                files,
                env: deployEnv,
                config,
                creatorLogin,
                seed: session.seed,
                onDeployStatus: (status) => {
                  session.deployStatus = status;
                  this.logDeploy(status);
                  this.state.storage.put("session", session).catch((e) => this.logError("deploy", `persist status: ${String(e)}`));
                  sendSSE({ type: "deploy_status", data: JSON.stringify(status) });
                  if (status.phase === "live") {
                    this.sendPush("Your build is live!");
                  } else if (status.phase === "error") {
                    this.appendAssistantError("deploy", status.error);
                    this.sendPush("Build failed");
                    // KEEP appId/appName: in Path B the repo + host route +
                    // registry are already created (registerViaAdmin) before the
                    // Actions build can fail, so the game IS provisioned — it just
                    // didn't build. Nulling appId told the next turn "not deployed"
                    // → it ran a fresh `deploy` → the uniqueness check saw the
                    // existing repo → "ID already taken", stranding the game with
                    // no in-session recovery. Retained, the next turn does
                    // push_update against the existing repo and re-runs CI.
                    this.state.storage.put("session", session).catch((e) => this.logError("deploy", `persist error: ${String(e)}`));
                  }
                },
                onAppDeployed: (id, name) => {
                  session.appId = id;
                  session.appName = name;
                  session.deployStatus = { phase: "provisioning", steps: [] };
                  this.state.storage.put("session", session).catch((e) => this.logError("deploy", `persist provision: ${String(e)}`));
                },
              });
            } catch (err) {
              toolResult = `Tool ${tc.name} threw an error: ${String(err)}`;
              this.logError("infra", toolResult);
            }

            sendSSE({ type: "tool_result", data: JSON.stringify({ id: tc.id, tool: tc.name, result: toolResult.slice(0, 500) }) });
            infraResults.push({ id: tc.id, content: toolResult.slice(0, 3000) });
          }

          // Merge infra results into the tool_result message the agent already
          // appended for this turn's file tools, if any. A single assistant
          // message can carry BOTH file and infra tool_uses; splitting their
          // results across two separate tool_result messages leaves the infra
          // tool_use unpaired on the next turn → a hard 400 from the provider
          // ("tool_use without tool_result") that bricks the session until reset.
          const lastMsg = session.messages[session.messages.length - 1];
          if (lastMsg?.role === "tool_result" && lastMsg.toolResults) {
            lastMsg.toolResults.push(...infraResults);
          } else {
            session.messages.push({ role: "tool_result", content: "", toolResults: infraResults });
          }

          // Persist state after all infra tools complete
          session.files = Object.fromEntries(files);
          await this.save();
        }

        sendSSE({ type: "done", data: "" });
      } catch (err) {
        const message = String(err);
        this.appendAssistantError("chat", message);
        // Surface the error to the client FIRST, then persist best-effort. If
        // save() throws (e.g. the session blob outgrew the DO value cap), the
        // old ordering meant the error SSE never fired and the stream just
        // closed — a silent hang. Now the user always sees what failed.
        sendSSE({ type: "error", data: message });
        await this.save().catch((e) => this.logError("storage", `save after error failed: ${String(e)}`));
      } finally {
        this.chatInProgress = false;
        writer.close().catch(() => {});
      }
    })();

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        ...corsHeaders(request, this.config.domain),
      },
    });
    } catch (err) {
      // Setup threw before the background turn launched (bad JSON, key decrypt,
      // load). Release the claim so the session isn't stuck "in progress"
      // forever, then surface the error.
      this.chatInProgress = false;
      return json({ error: String(err) }, 500, request, this.config.domain);
    }
  }

  /** GET /status — current session state */
  private async handleStatus(request: Request): Promise<Response> {
    const session = await this.load(false);
    return json(
      {
        messageCount: session.messages.length,
        fileCount: Object.keys(session.files).length,
        tokenUsage: session.tokenUsage,
        deployStatus: session.deployStatus,
        deployLog: session.deployLog,
        appId: session.appId,
        appUrl: session.deployStatus?.phase === "live" ? session.deployStatus.appUrl : null,
      },
      200,
      request,
      this.config.domain,
    );
  }

  /** GET /files — list files with sizes */
  private async handleListFiles(request: Request): Promise<Response> {
    const session = await this.load(false);
    const files = Object.entries(session.files).map(([path, content]) => ({
      path,
      size: content.length,
    }));
    return json({ files }, 200, request, this.config.domain);
  }

  private logError(source: string, message: string) {
    if (!this.session) return;
    this.session.errors.push({ timestamp: new Date().toISOString(), source, message: message.slice(0, 500) });
    if (this.session.errors.length > MAX_ERRORS) this.session.errors = this.session.errors.slice(-MAX_ERRORS);
  }

  /** Record a deploy phase on the append-only timeline (capped). */
  private logDeploy(status: DeployStatus) {
    if (!this.session) return;
    this.session.deployLog.push({ timestamp: new Date().toISOString(), phase: status.phase, detail: deployStatusDetail(status).slice(0, 500) });
    if (this.session.deployLog.length > MAX_DEPLOY_LOG) this.session.deployLog = this.session.deployLog.slice(-MAX_DEPLOY_LOG);
  }

  /** Push a message onto the transcript, keeping only the last MAX_MESSAGES. */
  private appendMessage(message: Message) {
    if (!this.session) return;
    this.session.messages.push(message);
    if (this.session.messages.length > MAX_MESSAGES) this.session.messages = this.session.messages.slice(-MAX_MESSAGES);
  }

  /** Surface a failure INTO the visible transcript (not just SSE/logError), so
   *  the user still sees what went wrong after a reload. De-duplicates against an
   *  identical trailing error so repeated failures don't stack. */
  private appendAssistantError(source: string, message: string) {
    this.logError(source, message);
    const text = `Error: ${message.slice(0, 2000)}`;
    if (this.session?.messages[this.session.messages.length - 1]?.content === text) return;
    this.appendMessage({ role: "assistant", content: text });
  }

  /** GET /errors — return server-side errors for debugging */
  private async handleErrors(request: Request): Promise<Response> {
    const session = await this.load(false);
    return json({ errors: session.errors }, 200, request, this.config.domain);
  }

  /** GET /history — return all conversation messages for restoring UI */
  private async handleHistory(request: Request): Promise<Response> {
    const session = await this.load(false);
    const history = session.messages.map((m) => ({
      role: m.role,
      content: m.content,
      toolCalls: m.toolCalls?.map((tc) => ({
        name: tc.name,
        input: { path: tc.input.path, id: tc.input.id },
      })),
      toolResults: m.toolResults?.map((tr) => ({
        id: tr.id,
        content: tr.content.slice(0, 500),
      })),
    }));
    return json(
      {
        messages: history,
        appId: session.appId,
        appName: session.appName,
        deployStatus: session.deployStatus,
        tokenUsage: session.tokenUsage,
        fileCount: Object.keys(session.files).length,
      },
      200,
      request,
      this.config.domain,
    );
  }

  /** POST /import { id } — bind this session to an EXISTING game by importing
   *  its committed repo files. This is how you "open" a game in VibeCode: the
   *  session's files become the real repo contents, so a later edit +
   *  push_update updates the game rather than overwriting it with a fresh
   *  scaffold. Ownership-gated (registry creatorGithub / member / legacy
   *  collaborator). Refuses to re-point a session already bound elsewhere. */
  private async handleImport(request: Request): Promise<Response> {
    // Refuse while a turn is streaming: import replaces session.files/appId, but
    // the in-flight turn holds the old `session` and keeps persisting it — the
    // import would be silently clobbered (or corrupt a half-written deploy).
    if (this.chatInProgress) {
      return json({ error: "A build is in progress — wait for it to finish before opening another game." }, 409, request, this.config.domain);
    }
    const body = await request.json<{ id?: string }>().catch(() => ({}) as { id?: string });
    const id = (body.id || "").trim();
    // GAME id grammar (lowercase slug, ≤58) — the registry lookup is the real
    // gate; this just rejects obviously malformed input before any API calls.
    if (!/^[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/.test(id)) {
      return json({ error: "a valid game id is required" }, 400, request, this.config.domain);
    }

    // The worker-verified GitHub login (set() in index.ts, un-spoofable). The
    // session owner is trust-on-first-use (X-Auth-User); ownership of the GAME
    // is a separate check — you must own the repo you're importing.
    const login = request.headers.get("X-Auth-Login") || "";
    if (!login) {
      return json({ error: "your GitHub login is unavailable — sign in again" }, 403, request, this.config.domain);
    }

    const session = await this.load();
    // Refuse to re-point a session already bound to a different game — its files
    // and history belong to that game; importing another would clobber them.
    if (session.appId && session.appId !== id) {
      return json({ error: `this session is already bound to "${session.appId}"` }, 409, request, this.config.domain);
    }

    const { owns, game } = await ownsGame(this.config, this.env.GITHUB_TOKEN, id, login);
    if (!game) return json({ error: `game "${id}" not found` }, 404, request, this.config.domain);
    if (!owns) return json({ error: `you don't have access to "${id}"` }, 403, request, this.config.domain);

    const appUrl = game.appUrl || `https://${id}.${this.config.domain}`;

    // Re-sync unless the repo is provably unchanged since our last import. This
    // is what makes "edit directly, then VibeCode again" pick up the latest
    // repo state: if someone pushed to the repo (update_files, git, another
    // session) the HEAD sha moved, so we re-fetch. If nothing changed AND we
    // already hold this game's files, skip the heavy walk and keep the session
    // as-is (preserving any in-progress, not-yet-deployed edits).
    const headSha = await fetchRepoHeadSha(id, this.env.GITHUB_TOKEN, this.config);
    const alreadyCurrent =
      session.appId === id &&
      !!session.importedSha &&
      !!headSha &&
      session.importedSha === headSha &&
      Object.keys(session.files || {}).length > 0;

    if (alreadyCurrent) {
      // Ensure the binding/liveness is set even on the fast path.
      session.appName = game.name || id;
      session.deployStatus = { phase: "live", appUrl };
      await this.save();
      return json(
        { ok: true, id, name: session.appName, appUrl, unchanged: true, fileCount: Object.keys(session.files).length },
        200,
        request,
        this.config.domain,
      );
    }

    let files: Map<string, string>;
    try {
      files = await fetchRepoFiles(id, this.env.GITHUB_TOKEN, this.config);
    } catch (err) {
      return json({ error: `import failed: ${String(err)}` }, 502, request, this.config.domain);
    }

    session.files = Object.fromEntries(files);
    session.appId = id;
    session.appName = game.name || id;
    session.importedSha = headSha ?? undefined;
    // The game is already live (it's in the registry) — reflect that so the
    // studio shows the preview + a deployed indicator, and infra tools treat it
    // as an existing app (push_update, not a fresh deploy).
    session.deployStatus = { phase: "live", appUrl };
    await this.save();

    // NOTE: the D1 session index (agent_sessions) is owned by the worker +
    // frontend (the DO has no session-id string and never writes D1). The
    // frontend's putSession/markDeployed after this import keeps that row in
    // sync, so we don't upsert it here.
    return json(
      { ok: true, id, name: session.appName, appUrl, fileCount: files.size },
      200,
      request,
      this.config.domain,
    );
  }

  /** POST /reset — start over (re-seeds from the canonical template repo) */
  private async handleReset(request: Request): Promise<Response> {
    // Refuse while a turn is streaming: the in-flight turn's deploy callbacks
    // still hold the pre-reset `session` and would persist it back over the
    // fresh one, silently undoing the reset.
    if (this.chatInProgress) {
      return json({ error: "A build is in progress — wait for it to finish before resetting." }, 409, request, this.config.domain);
    }
    this.session = await this.freshSession();
    await this.save();
    return json({ ok: true }, 200, request, this.config.domain);
  }

  /** POST /push-subscribe — store push subscription for notifications */
  private async handlePushSubscribe(request: Request): Promise<Response> {
    const sub = await request.json<PushSubscription>();
    if (!sub.endpoint) {
      return json({ error: "endpoint required" }, 400, request, this.config.domain);
    }
    await this.state.storage.put("pushSubscription", sub);
    return json({ ok: true }, 200, request, this.config.domain);
  }

  /** Send a push notification to the subscribed client */
  private async sendPush(_message: string): Promise<void> {
    if (!this.env.VAPID_PUBLIC_KEY || !this.env.VAPID_PRIVATE_KEY) return;
    const sub = await this.state.storage.get<PushSubscription>("pushSubscription");
    if (!sub) return;
    try {
      await sendWebPush(sub, this.env.VAPID_PUBLIC_KEY, this.env.VAPID_PRIVATE_KEY);
    } catch {
      // Push failed (subscription expired, etc.) — don't crash the session
    }
  }
}

// Dev origins only — exact host match so e.g. `http://localhost.evil.com` (a
// prefix match) can't slip through and make credentialed requests.
const DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function corsHeaders(request: Request, domain: string): Record<string, string> {
  const origin = request.headers.get("Origin");
  // Credentialed CORS is restricted to the FIRST-PARTY console origins only —
  // NOT `*.${domain}`. Published games are untrusted, user/agent-authored JS
  // served at `<slug>.${domain}`; reflecting those with credentials would let a
  // malicious or XSS'd game ride a signed-in user's `fgs_token` cookie to read
  // their transcripts, drive /chat, and read key status. The console is served
  // only at `console.`/`publish.`; the apex is the storefront (never calls this).
  const firstParty = origin === `https://console.${domain}` || origin === `https://publish.${domain}`;
  const allowed = origin && (firstParty || DEV_ORIGIN.test(origin)) ? origin : `https://console.${domain}`;
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
  };
}

function json(data: unknown, status: number, request: Request, domain: string): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(request, domain) },
  });
}
