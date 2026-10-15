/** Local adapter for the versioned registry/ownership contract. */
import type { StoreConfig } from "./config";
import { resilientFetch } from "./ghfetch";
import {
  validateGameId as contractValidateGameId,
  ownershipFacts as contractOwnershipFacts,
  type OwnershipFacts,
} from "../../../contracts/registry-ownership/v1/contract";

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

export { type OwnershipFacts };

// Wrapper for backward compatibility: contract uses signals object, agent uses positional parameters
export function validateGameId(id: string): boolean {
  const error = contractValidateGameId(id);
  return error === null;
}

// Wrapper for backward compatibility: convert positional parameters to signals object
export function ownershipFacts(
  game: Pick<RegistryGame, "creatorGithub"> | undefined,
  login: string,
  isOrgMember: boolean,
  isLegacyAcceptedCollaborator: boolean,
): OwnershipFacts {
  return contractOwnershipFacts(game, login, {
    isOrgMember,
    isLegacyAcceptedCollaborator,
  });
}

function parseRegistry(value: unknown, key: string): RegistryGame[] | null {
  if (!value || typeof value !== "object" || !Array.isArray((value as Record<string, unknown>)[key])) return null;
  return (value as Record<string, RegistryGame[]>)[key];
}

/** Prefer fresh Contents data, use raw only as a read fallback, and preserve failure state. */
export async function readRegistry(config: StoreConfig, token: string): Promise<RegistryReadResult> {
  const failures: string[] = [];
  const path = config.registryPath ?? "registry.json";
  let contentsMissing = false;
  try {
    const res = await resilientFetch(`https://api.github.com/repos/${config.org}/${config.storeRepo}/contents/${path}`, {
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
    const res = await fetch(`https://raw.githubusercontent.com/${config.org}/${config.storeRepo}/main/${path}`, {
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
