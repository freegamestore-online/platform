// The create canary's keyless session on the MCP (#531).
//
// The canary connects with its fgs_token as the bearer, not an OAuth grant, so
// the provider hands it to `resolveExternalToken`. Only a canary session is
// accepted there (auth verifies it; nothing else is an external token), and what
// it may then call is fixed here: create_game and delete_game, on
// e2e-create-*-test ids. Every other tool refuses it, so a tool added later is
// closed to the canary until someone opens it on purpose.
import { isCanaryGameId, isCanaryToken } from '../../../contracts/canary-session/v1/contract.js';
import type { McpProps } from './tools/registration.js';

/** The only tools a canary session may call. */
export const CANARY_TOOLS: ReadonlySet<string> = new Set(['create_game', 'delete_game']);

/** A session that is the canary's. `canary` is set by resolveCanaryToken, never by a client. */
export function isCanaryProps(props: McpProps | undefined): boolean {
  return props?.canary === true || isCanaryToken(props?.token);
}

/** Why a canary session may not make this tool call, or null (also for every ordinary session). */
export function canaryToolRefusal(
  props: McpProps | undefined,
  tool: string,
  args: unknown,
): string | null {
  if (!isCanaryProps(props)) return null;
  if (!CANARY_TOOLS.has(tool)) return `${tool} is not available to a canary session.`;
  const id = (args as { game_id?: unknown } | undefined)?.game_id;
  const normalized = typeof id === 'string' ? id.trim().toLowerCase() : id;
  if (!isCanaryGameId(normalized))
    return `${tool}: a canary session can only use e2e-create-*-test games.`;
  return null;
}

/** `resolveExternalToken` for the OAuth provider: props for a live canary session, else null. */
export async function resolveCanaryToken(input: {
  token: string;
  env: { AUTH: Fetcher };
}): Promise<{ props: McpProps } | null> {
  if (!isCanaryToken(input.token)) return null;
  try {
    const res = await input.env.AUTH.fetch('https://auth.freegamestore.online/canary/authorize', {
      method: 'POST',
      headers: { 'X-FGS-Token': input.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify' }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { sub?: unknown };
    if (typeof body.sub !== 'string') return null;
    return { props: { canary: true, token: input.token, sub: body.sub } };
  } catch {
    return null;
  }
}
