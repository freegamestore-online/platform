const PREFIX = "fgs_initial_build:";

export interface InitialBuild {
  prompt: string;
  createdAt: number;
}

export interface BuildPromptFields {
  gameName: string;
  gameId: string;
  category: string;
  description?: string;
  template?: string;
  cloneFrom?: string;
  buildPrompt?: string;
}

function storageKey(gameId: string): string {
  return `${PREFIX}${gameId}`;
}

export function buildInitialPrompt(fields: BuildPromptFields): string {
  const explicit = fields.buildPrompt?.trim();
  if (explicit) return explicit;

  const parts = [
    `Build the first playable version of ${fields.gameName || fields.gameId}.`,
    fields.description?.trim() ? `Use this concept: ${fields.description.trim()}.` : "",
    fields.cloneFrom?.trim()
      ? `It is a remix of ${fields.cloneFrom.trim()}, so keep the inherited engine and make the new theme clear.`
      : fields.template?.trim()
        ? `Use the selected ${fields.template.trim()} starter.`
        : "",
    `Make it polished, kid-friendly, responsive, and deploy it when the first version is playable.`,
  ];
  return parts.filter(Boolean).join(" ");
}

export function queueInitialBuild(gameId: string, prompt: string): void {
  if (!gameId || !prompt.trim()) return;
  localStorage.setItem(storageKey(gameId), JSON.stringify({ prompt: prompt.trim(), createdAt: Date.now() }));
}

export function readInitialBuild(gameId: string | undefined | null): InitialBuild | null {
  if (!gameId) return null;
  const raw = localStorage.getItem(storageKey(gameId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<InitialBuild>;
    return typeof parsed.prompt === "string" && parsed.prompt.trim()
      ? { prompt: parsed.prompt.trim(), createdAt: typeof parsed.createdAt === "number" ? parsed.createdAt : 0 }
      : null;
  } catch {
    return null;
  }
}

export function clearInitialBuild(gameId: string | undefined | null): void {
  if (gameId) localStorage.removeItem(storageKey(gameId));
}
