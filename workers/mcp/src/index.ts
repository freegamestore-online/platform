import { WorkerEntrypoint } from 'cloudflare:workers';
import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import { McpServer, type ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpAgent } from 'agents/mcp';
import type { z } from 'zod';
import authHandler from './auth-handler.js';
import { ownershipFacts, readRegistryGames } from './github.js';
import { errMsg } from './http.js';
import type { SafetyContext } from './safety.js';
import { registerAdminTools } from './tools/admin.js';
import { registerBuildSessionTools } from './tools/build-session.js';
import { registerCatalogTools } from './tools/catalog.js';
import { registerGameFilesTools } from './tools/game-files.js';
import {
  createRegistrationContext,
  type Env,
  errText,
  type McpProps,
  type RegistrationContext,
} from './tools/registration.js';

export type { Env, McpProps } from './tools/registration.js';

// Scope VibeCode agent sessions to the caller.
function sessionPrefix(userId?: string): string {
  const u = (userId ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'anon';
  return `mcp-${u}-`;
}

export class FgsMcpAgent extends McpAgent<Env, unknown, McpProps> {
  server = new McpServer({
    name: 'FreeGameStore',
    version: '0.1.0',
  });

  async setAuth(props: McpProps): Promise<void> {
    this.props = props;
    try {
      await (
        this as unknown as { ctx: { storage: { put(k: string, v: unknown): Promise<void> } } }
      ).ctx.storage.put('props', props);
    } catch {
      /* in-memory set is enough for the immediately-following tool call */
    }
  }

  /**
   * Agents 0.24 loads durable-object props asynchronously, so they can be
   * absent for an unauthenticated request. Treat that state as empty auth
   * rather than dereferencing an optional value in a tool handler.
   */
  private get session(): McpProps {
    return this.props ?? {};
  }

  /** Ownership gate: does the session user own this published game?
   *  FGS has no /v1/apps/mine — registry.json's creatorGithub is the record. */
  private async ownsGame(gameId: string): Promise<boolean> {
    const login = this.session.userId;
    if (!login) return false;
    const registry = await readRegistryGames(
      this.env.GITHUB_ORG,
      this.env.STORE_REPO,
      this.env.GITHUB_TOKEN,
    );
    if (registry.status === 'unavailable')
      throw new Error(`registry unavailable: ${registry.detail}`);
    if (registry.status === 'missing') return false;
    // The MCP write policy deliberately authorizes creators only; the common
    // evaluator still exposes all facts for conformance and future operations.
    return ownershipFacts(
      registry.games.find((g) => g.id === gameId),
      login,
      {
        isOrgMember: false,
        isLegacyAcceptedCollaborator: false,
      },
    ).isCreator;
  }

  /** Safety context for the current caller: env (read-only flag + audit KV) and
   *  the GitHub login the audit trail is keyed on. */
  private safety(): SafetyContext {
    return { env: this.env, subject: this.session.userId };
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

  async init(): Promise<void> {
    // Live view of the props: they can arrive (setAuth) after init() (#72).
    const ctx = createRegistrationContext({
      server: this.server,
      env: this.env,
      ownerSlug: this.env.GITHUB_ORG,
      safeTool: this.safeTool.bind(this) as RegistrationContext['safeTool'],
      ownsGame: this.ownsGame.bind(this),
      sessionPrefix,
      session: () => this.session,
      safety: () => this.safety(),
    });
    registerCatalogTools(ctx);
    registerGameFilesTools(ctx);
    registerBuildSessionTools(ctx);
    registerAdminTools(ctx);
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
    const sessionId = request.headers.get('mcp-session-id');
    if (props?.token && sessionId) {
      try {
        const id = this.env.MCP_OBJECT.idFromName(`streamable-http:${sessionId}`);
        const stub = this.env.MCP_OBJECT.get(id) as unknown as {
          setAuth(p: McpProps): Promise<void>;
        };
        await stub.setAuth(props);
      } catch {
        /* best effort */
      }
    }
    return FgsMcpAgent.serve('/mcp').fetch(request, this.env, this.ctx);
  }
}

// Best-practice MCP auth via @cloudflare/workers-oauth-provider: it handles
// /token, /register, discovery metadata, the 401 challenge, PKCE, and
// audience-bound tokens. Sign-in is delegated to the auth worker (auth-handler.ts),
// so the MCP needs no GitHub app of its own.
export default new OAuthProvider({
  apiRoute: '/mcp',
  apiHandler: FgsApiHandler as never,
  defaultHandler: authHandler as never,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
});
