/** Local adapter for the versioned registry/ownership contract. */
import type { StoreConfig } from "./config";
import { resilientFetch } from "./ghfetch";

export interface RegistryGame {
  id: string;
  name?: string;
  creatorGithub?: string;
  developer?: string;
  appUrl?: string;
  [key: string]: unknown;
}

export type RegistryReadResult =
  | { status: "available"; games: RegistryGame[] }
  | { status: "missing" }
  | { status: "unavailable"; detail: string };

export interface OwnershipFacts {
  isCreator: boolean;
  isOrgMember: boolean;
  isLegacyAcceptedCollaborator: boolean;
}

const RESERVED = new Set([
  "freegamestore",
  "submissions",
  "template-game-canvas",
  "template-game-3d",
  "template-game-grid",
  "template-game-cards",
  "template-game-kaplay",
  "template-game-phaser",
  "template-game-pixi",
  "template-game-babylon",
  "template-game-excalibur",
  "template-game-littlejs",
  "brand",
  "ops",
  "sdk",
]);

export function validateGameId(id: string): boolean {
  return (
    id.length >= 3 &&
    id.length <= 58 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(id) &&
    !id.startsWith("free") &&
    !id.startsWith("pro") &&
    !id.startsWith("template-game-") &&
    !RESERVED.has(id)
  );
}

export function ownershipFacts(
  game: Pick<RegistryGame, "creatorGithub"> | undefined,
  login: string,
  isOrgMember: boolean,
  isLegacyAcceptedCollaborator: boolean,
): OwnershipFacts {
  return {
    isCreator: !!game?.creatorGithub && game.creatorGithub.toLowerCase() === login.toLowerCase(),
    isOrgMember,
    isLegacyAcceptedCollaborator: !game?.creatorGithub && isLegacyAcceptedCollaborator,
  };
}

function parseRegistry(value: unknown, key: string): RegistryGame[] | null {
  if (!value || typeof value !== "object" || !Array.isArray((value as Record<string, unknown>)[key])) return null;
  return (value as Record<string, RegistryGame[]>)[key];
}

/** Prefer fresh Contents data, use raw only as a read fallback, and preserve failure state. */
export async function readRegistry(config: StoreConfig, token: string): Promise<RegistryReadResult> {
  const failures: string[] = [];
  let contentsMissing = false;
  try {
    const res = await resilientFetch(`https://api.github.com/repos/${config.org}/${config.storeRepo}/contents/registry.json`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.raw+json", "User-Agent": config.agentName },
    });
    if (res.ok) {
      const games = parseRegistry(await res.json(), config.nounPlural);
      if (games) return { status: "available", games };
      failures.push("contents API malformed");
    } else if (res.status === 404) contentsMissing = true;
    else failures.push(`contents API ${res.status}`);
  } catch (e) {
    failures.push(`contents API ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${config.org}/${config.storeRepo}/main/registry.json`, {
      headers: { "User-Agent": config.agentName },
    });
    if (res.ok) {
      const games = parseRegistry(await res.json(), config.nounPlural);
      if (games) return { status: "available", games };
      failures.push("raw malformed");
    } else if (res.status === 404 && contentsMissing) return { status: "missing" };
    else failures.push(`raw ${res.status}`);
  } catch (e) {
    failures.push(`raw ${e instanceof Error ? e.message : String(e)}`);
  }
  return { status: "unavailable", detail: failures.join("; ") || "registry unavailable" };
}
