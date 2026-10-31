import { useCallback, useEffect, useState } from 'react';

const THEME_KEY = 'stores-theme';
type Pref = 'system' | 'light' | 'dark';

// Storage can be unavailable: privacy modes, blocked third-party storage in an
// iframe, or disabled cookies make even reading `window.localStorage` throw a
// SecurityError. This runs during render, so an unguarded access crashed the
// whole game (#99) — the toggle must degrade to an unsaved preference instead.
function getStoredPref(): Pref {
  if (typeof window === 'undefined') return 'system';
  try {
    const s = window.localStorage.getItem(THEME_KEY);
    if (s === 'light' || s === 'dark' || s === 'system') return s;
  } catch {
    // Storage blocked — fall back to the default.
  }
  return 'system';
}

function storePref(pref: Pref) {
  try {
    window.localStorage.setItem(THEME_KEY, pref);
  } catch {
    // Storage blocked or full — the theme still applies for this visit.
  }
}

function darkQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia('(prefers-color-scheme: dark)');
}

function resolve(pref: Pref): 'light' | 'dark' {
  if (pref !== 'system') return pref;
  return darkQuery()?.matches ? 'dark' : 'light';
}

function apply(pref: Pref) {
  if (typeof document === 'undefined') return;
  const theme = resolve(pref);
  if (theme === 'dark') {
    document.documentElement.dataset.theme = 'dark';
  } else {
    delete document.documentElement.dataset.theme;
  }
  storePref(pref);
}

/**
 * Compact theme toggle for game topbars. Sun/moon icon, 28px square.
 * Designed to fit in GameTopbar's `actions` slot.
 */
export function GameThemeToggle() {
  const [pref, setPref] = useState<Pref>(getStoredPref);
  const theme = resolve(pref);

  // Keep the DOM in sync with the preference — on mount (so a saved theme is
  // applied on reload, not just when cycled) and on every change.
  useEffect(() => {
    apply(pref);
  }, [pref]);

  // "system" follows the OS: re-apply when the OS theme changes, rather than
  // only on reload.
  const [, setOsTick] = useState(0);
  useEffect(() => {
    if (pref !== 'system') return;
    const mq = darkQuery();
    if (!mq) return;
    const onChange = () => {
      apply('system');
      setOsTick((n) => n + 1); // re-render so the icon matches
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [pref]);

  const cycle = useCallback(() => {
    const order: Pref[] = ['system', 'light', 'dark'];
    const next = order[(order.indexOf(pref) + 1) % order.length]!;
    setPref(next); // the effect applies it
  }, [pref]);

  return (
    <button
      onClick={cycle}
      aria-label={`Theme: ${pref}`}
      title={`Theme: ${pref}`}
      className="inline-flex size-7 cursor-pointer items-center justify-center rounded-lg border border-line bg-panel p-0 text-ink"
    >
      {theme === 'dark' ? (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
      ) : (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}
