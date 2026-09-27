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

export const txt = (text: string) => ({ content: [{ type: 'text' as const, text }] });
export const errText = (text: string) => ({
  content: [{ type: 'text' as const, text }],
  isError: true as const,
});
