const CURRENT_KEY = "fgs_current_project";

export function currentProjectStorageKey(userSub: string | null | undefined): string {
  return userSub ? `${CURRENT_KEY}:${userSub}` : CURRENT_KEY;
}

export function readCurrentProjectId(userSub: string | null | undefined): string | null {
  try {
    if (!userSub) return null;
    return localStorage.getItem(currentProjectStorageKey(userSub)) || localStorage.getItem(CURRENT_KEY);
  } catch {
    return null;
  }
}

export function writeCurrentProjectId(userSub: string | null | undefined, id: string | null): void {
  try {
    const key = currentProjectStorageKey(userSub);
    if (id) localStorage.setItem(key, id);
    else localStorage.removeItem(key);
    if (userSub) localStorage.removeItem(CURRENT_KEY);
  } catch {
    // Blocked storage should not break the studio.
  }
}
