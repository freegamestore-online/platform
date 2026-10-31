/** Console theme preference (DESIGN-SYSTEM.md §3 and §4). One mechanism: the
 *  `data-theme="dark"` attribute on <html>; light is the absence of the attribute.
 *  The choice (`system` | `light` | `dark`) is stored under the shared
 *  `stores-theme` key so it follows the user between stores, and applied before
 *  first paint by the inline boot script in index.html (re-applied in main.tsx). */

export type ThemePref = 'system' | 'light' | 'dark';

export const THEME_KEY = 'stores-theme';

export const THEME_PREFS: { value: ThemePref; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/** The saved preference, or `system` when none is saved or storage is blocked. */
export function getThemePref(): ThemePref {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
  } catch {
    // Storage can throw (privacy modes, blocked third-party storage): use the default.
    return 'system';
  }
}

function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

/** What the preference means right now: `system` follows the OS. */
export function resolveTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return pref;
}

/** Set `data-theme` on <html> for the preference and save it. Storage failures are ignored. */
export function applyTheme(pref: ThemePref): void {
  if (typeof document !== 'undefined') {
    if (resolveTheme(pref) === 'dark') document.documentElement.dataset.theme = 'dark';
    else delete document.documentElement.dataset.theme;
  }
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(THEME_KEY, pref);
    } catch {
      // The theme still applies for this visit.
    }
  }
}

/** The next preference in the toggle cycle: system -> light -> dark -> system. */
export function nextThemePref(pref: ThemePref): ThemePref {
  return pref === 'system' ? 'light' : pref === 'light' ? 'dark' : 'system';
}

/** Re-apply `system` when the OS theme changes. Returns an unsubscribe function. */
export function watchSystemTheme(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
