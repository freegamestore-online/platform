/**
 * Shared game-id validation for the publisher API.
 *
 * `validateId` and `INFRA_REPOS` were previously copy-pasted into both
 * create.ts and check-id.ts. Within a single repo two copies can silently
 * drift, so "Check" would report an id available that "Create Game" then
 * rejects (or vice-versa). This module is the single source of truth both
 * endpoints import, guaranteeing they always agree.
 */

// Reserved / infrastructure repos that must never be targetable as a game id.
export const INFRA_REPOS = new Set([
  "freegamestore", "submissions", "template-game-canvas", "template-game-3d",
  "template-game-grid", "template-game-cards", "template-game-kaplay",
  "template-game-phaser", "template-game-pixi", "template-game-babylon",
  "brand", "ops", "sdk",
]);

/** Returns an error string if `id` is not a provisionable game id, else null. */
export function validateId(id: string): string | null {
  if (!id) return "ID is required";
  if (id.length > 58) return "58 characters max";
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(id)) return "Lowercase letters, numbers, dashes only. No leading/trailing dash.";
  if (id.startsWith("free") || id.startsWith("pro")) return "Cannot start with 'free' or 'pro'";
  // Reject reserved infra ids AND every template-game-* variant (matches admin's
  // validateId so "Check" never reports available an id that Create then rejects).
  if (INFRA_REPOS.has(id) || id.startsWith("template-game-")) return "Reserved id";
  return null;
}
