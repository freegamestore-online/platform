/**
 * Shared MCP access-token lifetime. Keep this explicit instead of inheriting
 * the OAuth provider's library default so FGS sign-in behaviour is stable.
 */
export const MCP_ACCESS_TOKEN_TTL_SECONDS = 30 * 86_400;
