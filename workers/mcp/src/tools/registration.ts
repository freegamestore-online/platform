import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import type { McpServer, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z } from 'zod';
import type { SafetyContext } from '../safety.js';

export interface Env {
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
  MCP_READ_ONLY?: string;
}

export interface McpProps extends Record<string, unknown> {
  userId?: string;
  token?: string;
}

export type SafeTool = <Args extends z.ZodRawShape>(
  name: string,
  description: string,
  paramsSchema: Args,
  cb: ToolCallback<Args>,
) => void;

export interface RegistrationContext {
  server: McpServer;
  env: Env;
  session: McpProps;
  login?: string;
  accessToken?: string;
  ownerSlug: string;
  safetyCtx: SafetyContext;
  safeTool: SafeTool;
  ownsGame(gameId: string): Promise<boolean>;
  sessionPrefix(userId?: string): string;
}

/**
 * Build the context the tool modules register against. `session`, `login`,
 * `accessToken` and `safetyCtx` are GETTERS over the agent's current props, not
 * values copied at init(): Agents loads Durable Object props asynchronously and
 * setAuth() can replace them after init() has registered the tools. A snapshot
 * left every tool on the init-time props for the life of the instance, so a
 * session that arrived late read as "Not authenticated" and audited as `anon`
 * (#72, a regression from the 6ff31fd module split, where handlers used to read
 * `this.session` on every call).
 */
export function createRegistrationContext(src: {
  server: McpServer;
  env: Env;
  ownerSlug: string;
  safeTool: SafeTool;
  ownsGame(gameId: string): Promise<boolean>;
  sessionPrefix(userId?: string): string;
  /** Current props (read on every access). */
  session(): McpProps;
  /** Current safety context (read on every access). */
  safety(): SafetyContext;
}): RegistrationContext {
  return {
    server: src.server,
    env: src.env,
    ownerSlug: src.ownerSlug,
    safeTool: src.safeTool,
    ownsGame: src.ownsGame,
    sessionPrefix: src.sessionPrefix,
    get session() {
      return src.session();
    },
    get login() {
      return src.session().userId;
    },
    get accessToken() {
      return src.session().token;
    },
    get safetyCtx() {
      return src.safety();
    },
  };
}

export const txt = (text: string) => ({ content: [{ type: 'text' as const, text }] });
export const errText = (text: string) => ({
  content: [{ type: 'text' as const, text }],
  isError: true as const,
});
