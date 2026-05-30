import { useCallback, useState } from 'react';

const THEME_KEY = 'stores-theme';
type Pref = 'system' | 'light' | 'dark';

function getStoredPref(): Pref {
  if (typeof window === 'undefined') return 'system';
  const s = window.localStorage.getItem(THEME_KEY);
  if (s === 'light' || s === 'dark' || s === 'system') return s;
  return 'system';
}

function resolve(pref: Pref): 'light' | 'dark' {
  if (pref !== 'system') return pref;
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function apply(pref: Pref) {
  if (typeof document === 'undefined') return;
  const theme = resolve(pref);
  if (theme === 'dark') {
    document.documentElement.dataset.theme = 'dark';
  } else {
    delete document.documentElement.dataset.theme;
  }
  window.localStorage.setItem(THEME_KEY, pref);
}

/**
 * Compact theme toggle for game topbars. Sun/moon icon, 28px square.
 * Designed to fit in GameTopbar's `actions` slot.
 */
export function GameThemeToggle() {
  const [pref, setPref] = useState<Pref>(getStoredPref);
  const theme = resolve(pref);

  const cycle = useCallback(() => {
    const order: Pref[] = ['system', 'light', 'dark'];
    const next = order[(order.indexOf(pref) + 1) % order.length]!;
    setPref(next);
    apply(next);
  }, [pref]);

  return (
    <button
      onClick={cycle}
      aria-label={`Theme: ${pref}`}
      title={`Theme: ${pref}`}
      style={{
        width: 28,
        height: 28,
        borderRadius: 8,
        border: '1px solid var(--line, #e2e8f0)',
        background: 'var(--panel, #ffffff)',
        color: 'var(--ink, #1e293b)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        padding: 0,
        fontFamily: 'inherit',
      }}
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
