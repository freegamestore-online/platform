// MCP safety layer — vendored (not shared) from the FAS/PAGS/FDS MCP servers.
//
// FGS already gates writes by GitHub identity + ownership inside each tool (see
// `ownsGame`, the admin-only tools, and the server-side ownership checks the
// admin/agent workers enforce). So this module deliberately omits the PAGS-style
// read/write/runtime/destructive scope taxonomy. What it adds are the cross-store
// maturity primitives that are orthogonal to ownership:
//
//   - read-only mode      (MCP_READ_ONLY=1 disables every write tool)
//   - per-account audit    (every write/dry-run/denied action, 90-day TTL in KV)
//   - dry-run previews      (validate + describe a mutation without committing)
//   - confirmation gates     (destructive tools require an explicit confirm token)
//   - redaction              (secrets stripped by key name AND value shape before logging)
//
// Keep this in sync BY HAND with the sibling stores — it is vendored, not shared.
// Audit events land in OAUTH_KV, which the worker already binds for the OAuth flow;
// no extra namespace to provision.

export type TextResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

interface SafetyEnv {
  OAUTH_KV?: KVNamespace;
  MCP_READ_ONLY?: string;
}

export interface SafetyContext {
  env: SafetyEnv;
  /** GitHub login of the caller — the audit trail is keyed on it. Anonymous
   *  callers (no session) are not audited, matching FAS/PAGS/FDS. */
  subject?: string;
}

const errResult = (text: string): TextResult => ({
  content: [{ type: 'text', text }],
  isError: true,
});
const jsonResult = (value: unknown): TextResult => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
});

export function isReadOnly(env: SafetyEnv): boolean {
  return env.MCP_READ_ONLY === '1';
}

/** Block a write tool when the server is in read-only mode. Returns an error
 *  result to hand straight back to the client, or null when the call may proceed. */
export async function requireWritable(
  ctx: SafetyContext,
  tool: string,
  input?: Record<string, unknown>,
): Promise<TextResult | null> {
  if (!isReadOnly(ctx.env)) return null;
  await audit(ctx, { tool, action: 'denied', reason: 'read_only', input });
  return errResult(
    `Error: ${tool} is a write tool, but this MCP server is in read-only mode (MCP_READ_ONLY=1).`,
  );
}

/** Require an exact confirmation token before a destructive tool runs. */
export async function requireConfirmation(
  ctx: SafetyContext,
  tool: string,
  confirm: string | undefined,
  expected: string,
  input?: Record<string, unknown>,
): Promise<TextResult | null> {
  if (confirm === expected) return null;
  await audit(ctx, { tool, action: 'denied', reason: 'missing_confirmation', expected, input });
  return errResult(
    `Error: ${tool} is destructive and cannot be undone. Re-run with confirm="${expected}" to proceed.`,
  );
}

/** Preview a mutation: audit the attempt and return what would happen, without committing. */
export async function dryRun(
  ctx: SafetyContext,
  tool: string,
  action: string,
  input: Record<string, unknown>,
  wouldDo: unknown,
): Promise<TextResult> {
  const body = { dryRun: true, tool, action, wouldDo };
  await audit(ctx, { tool, action: 'dry_run', input, result: body });
  return jsonResult(body);
}

/** Append one audit event for the caller. No-op for anonymous callers or when
 *  OAUTH_KV is unbound, so it is always safe to call. */
export async function audit(ctx: SafetyContext, event: Record<string, unknown>): Promise<void> {
  if (!ctx.env.OAUTH_KV || !ctx.subject) return;
  const now = new Date().toISOString();
  const key = `audit:${ctx.subject}:${now}:${crypto.randomUUID()}`;
  await ctx.env.OAUTH_KV.put(
    key,
    JSON.stringify({
      time: now,
      subject: ctx.subject,
      ...(redact(event) as Record<string, unknown>),
    }),
    { expirationTtl: 90 * 86_400 },
  );
}

/** Read the caller's own audit events, newest first. */
export async function listAuditEvents(ctx: SafetyContext, limit = 50): Promise<unknown[]> {
  if (!ctx.env.OAUTH_KV || !ctx.subject) return [];
  const safeLimit = Math.max(1, Math.min(200, limit));
  const listed = await ctx.env.OAUTH_KV.list({ prefix: `audit:${ctx.subject}:`, limit: safeLimit });
  const rows = await Promise.all(
    listed.keys
      .sort((a, b) => b.name.localeCompare(a.name))
      .slice(0, safeLimit)
      .map(async (key) => {
        const raw = await ctx.env.OAUTH_KV?.get(key.name);
        if (!raw) return null;
        try {
          return JSON.parse(raw) as unknown;
        } catch {
          return { raw };
        }
      }),
  );
  return rows.filter((row) => row !== null);
}

// Value shapes that look like a live secret even under an innocent key name —
// FGS's agent_build/edit_game accept a caller-supplied api_key, so redacting by
// key name alone is not enough to keep keys out of the audit log.
const SECRET_VALUE = new RegExp(
  [
    'sk-(?:ant-)?[A-Za-z0-9_-]{16,}', // OpenAI / Anthropic
    'gh[pousr]_[A-Za-z0-9]{20,}', // GitHub tokens
    'AIza[0-9A-Za-z_-]{20,}', // Google API key
    'eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{4,}', // JWT
    'Bearer\\s+[A-Za-z0-9._-]{12,}', // bearer header
  ].join('|'),
  'gi',
);

/** Strip credential-shaped keys and values, and truncate long strings, before anything is logged. */
function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[truncated]';
  if (typeof value === 'string') {
    const masked = value.replace(SECRET_VALUE, '[redacted]');
    return masked.length > 500 ? `${masked.slice(0, 500)}...` : masked;
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      /token|secret|password|credential|authorization|auth|api[_-]?key|apikey|access[_-]?(code|token)|refresh[_-]?token|bearer|private[_-]?key|client[_-]?secret|cookie/i.test(
        key,
      )
    ) {
      out[key] = '[redacted]';
    } else {
      out[key] = redact(item, depth + 1);
    }
  }
  return out;
}
