/**
 * Shared registry ownership contract: game-id validation, reserved IDs, ownership facts,
 * JWT verification, and GitHub username validation. Consolidated from duplicates across
 * workers/agent, workers/mcp, workers/auth, workers/leaderboard, apps/admin, apps/console.
 *
 * Security-relevant rules live here so changes propagate uniformly and consistently.
 * All caller patterns use the same logic and signatures.
 */

/** Game ID validation failure reasons and reserved list. */
export const RESERVED_GAME_IDS = new Set([
  // Infrastructure repos
  'freegamestore',
  'submissions',
  'template-game-canvas',
  'template-game-3d',
  'template-game-grid',
  'template-game-cards',
  'template-game-kaplay',
  'template-game-phaser',
  'template-game-pixi',
  'template-game-babylon',
  'template-game-excalibur',
  'template-game-littlejs',
  'brand',
  'ops',
  'sdk',
  // Platform subdomains and services (prevent collision with real services)
  'console',
  'publish',
  'www',
  'api',
  'auth',
  'admin',
  'mcp',
  'agent',
  'leaderboard',
  'host',
  'platform',
]);

/**
 * Validate a game ID for conformance and reject reserved/infrastructure names.
 * Returns error message on failure, null on success.
 */
export function validateGameId(id: string): string | null {
  if (!id) return 'ID is required';
  if (id.length < 3) return 'ID must be at least 3 characters';
  if (id.length > 58) return 'ID must be 58 characters or less';
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(id)) {
    return 'ID must be lowercase letters, numbers, and dashes only. Cannot start/end with a dash.';
  }
  if (id.startsWith('free') || id.startsWith('pro')) {
    return "ID must not start with 'free' or 'pro'";
  }
  // Reject reserved infra ID (exact match) plus every template-game-* variant
  // so a new template can't be squatted before its constant is added here.
  if (RESERVED_GAME_IDS.has(id) || id.startsWith('template-game-')) {
    return 'ID is reserved';
  }
  return null;
}

/** GitHub username grammar. Must be a valid GitHub login (attacker-influenced input). */
export const VALID_GH_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

/** Ownership facts derived from game data and membership/collaborator signals. */
export interface OwnershipFacts {
  isCreator: boolean;
  isOrgMember: boolean;
  isLegacyAcceptedCollaborator: boolean;
}

/**
 * Derive ownership facts from game data (registry), login, and membership signals.
 * Shared contract: all callers agree on when creator/org/legacy facts apply.
 *
 * @param game Game data (undefined or object with optional creatorGithub)
 * @param login GitHub login to check
 * @param signals Membership and collaborator signals (isOrgMember, isLegacyAcceptedCollaborator)
 */
export function ownershipFacts(
  game: { creatorGithub?: unknown } | undefined,
  login: string,
  signals: Pick<OwnershipFacts, 'isOrgMember' | 'isLegacyAcceptedCollaborator'>,
): OwnershipFacts {
  const creator = typeof game?.creatorGithub === 'string' ? game.creatorGithub : '';
  return {
    isCreator: !!creator && creator.toLowerCase() === login.toLowerCase(),
    isOrgMember: signals.isOrgMember,
    isLegacyAcceptedCollaborator: !creator && signals.isLegacyAcceptedCollaborator,
  };
}

/** Immutable fork attribution for lineage tracking. */
export interface ForkAttribution {
  id: string;
  name: string;
  creatorGithub: string;
  forkedAt: string;
}

/** Legacy #35 entries use a source id string; new entries use ForkAttribution. */
export type ForkedFrom = ForkAttribution | string;

/**
 * Check if a value is a valid ForkAttribution (all four fields present and valid).
 */
export function isForkAttribution(value: unknown): value is ForkAttribution {
  if (!value || typeof value !== 'object') return false;
  const attribution = value as Record<string, unknown>;
  return (
    typeof attribution.id === 'string' &&
    !validateGameId(attribution.id) &&
    typeof attribution.name === 'string' &&
    attribution.name.trim().length > 0 &&
    typeof attribution.creatorGithub === 'string' &&
    VALID_GH_LOGIN.test(attribution.creatorGithub) &&
    typeof attribution.forkedAt === 'string' &&
    !Number.isNaN(Date.parse(attribution.forkedAt))
  );
}

/**
 * Build a ForkAttribution snapshot from registry source data.
 * Returns undefined if source doesn't have all required fields.
 */
export function snapshotForkAttribution(
  sourceId: string,
  source: Record<string, unknown> | undefined,
  forkedAt: unknown,
): ForkAttribution | undefined {
  if (
    !source ||
    source.id !== sourceId ||
    typeof source.name !== 'string' ||
    !source.name.trim() ||
    typeof source.creatorGithub !== 'string' ||
    !VALID_GH_LOGIN.test(source.creatorGithub) ||
    typeof forkedAt !== 'string' ||
    Number.isNaN(Date.parse(forkedAt))
  ) {
    return undefined;
  }
  return {
    id: sourceId,
    name: source.name.trim(),
    creatorGithub: source.creatorGithub,
    forkedAt,
  };
}

/**
 * Present old string lineage as rich ForkAttribution only when the registry has
 * all four facts. Otherwise leave the string intact; guessing would make a mutable
 * source look like an immutable historical credit (safety over cleverness).
 *
 * @param value The forkedFrom value (string, ForkAttribution, or unknown)
 * @param registry Array of game entries from registry
 * @param legacyForkedAt Timestamp for the game (used if upgrading from string to ForkAttribution)
 */
export function normalizeForkedFrom(
  value: unknown,
  registry: Array<Record<string, unknown>>,
  legacyForkedAt: unknown,
): ForkedFrom | undefined {
  if (isForkAttribution(value)) return value;
  if (typeof value !== 'string' || validateGameId(value)) return undefined;
  return (
    snapshotForkAttribution(
      value,
      registry.find((entry) => entry.id === value),
      legacyForkedAt,
    ) ?? value
  );
}

/**
 * Verify an FGS JWT token with typ and aud validation.
 * Self-contained HS256 verification for session tokens and inter-service authentication.
 *
 * @param token The JWT token (header.payload.signature format)
 * @param signingKey The HMAC secret used to sign the token
 * @param options Validation options: { typ?, aud? } (optional checks for token type and audience)
 * @returns Decoded payload if valid, null if invalid, expired, or checks fail
 */
export async function verifyFgsJwt(
  token: string,
  signingKey: string,
  options?: { typ?: string; aud?: string },
): Promise<{ [key: string]: unknown } | null> {
  try {
    // Fail closed if the key is missing — never verify against an undefined key
    if (!signingKey) return null;

    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(signingKey),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );

    // Decode and verify signature
    const sig = Uint8Array.from(atob(parts[2]!), (c) => c.charCodeAt(0));
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      sig,
      encoder.encode(`${parts[0]}.${parts[1]}`),
    );
    if (!valid) return null;

    // Decode header and payload
    const header = JSON.parse(atob(parts[0]!)) as { alg: string; typ?: string };
    const payload = JSON.parse(atob(parts[1]!)) as { [key: string]: unknown; exp?: number };

    // Check algorithm
    if (header.alg !== 'HS256') return null;

    // Check typ if specified in options
    if (options?.typ && header.typ !== options.typ) return null;

    // Check aud if specified in options
    if (options?.aud && payload.aud !== options.aud) return null;

    // Check expiration
    if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}
