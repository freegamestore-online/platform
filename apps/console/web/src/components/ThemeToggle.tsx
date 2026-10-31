import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  applyTheme,
  getThemePref,
  nextThemePref,
  resolveTheme,
  type ThemePref,
  watchSystemTheme,
} from '../lib/theme';

/** Header theme toggle (DESIGN-SYSTEM.md §4). `compact` is the 28px desktop-header size (keeps the
 *  header height); the default is the 44px touch target. Cycles system → light → dark, shows the
 *  icon for the preference, and writes `stores-theme` plus `data-theme` on <html>. */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [pref, setPref] = useState<ThemePref>(getThemePref);

  // "system" follows the OS: re-apply when it changes, and keep the icon in step.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (pref !== 'system') return;
    return watchSystemTheme(() => {
      applyTheme('system');
      setTick((n) => n + 1);
    });
  }, [pref]);

  function cycle() {
    const next = nextThemePref(pref);
    setPref(next);
    applyTheme(next);
  }

  const label = `Theme: ${pref}`;
  const Icon = pref === 'system' ? Monitor : resolveTheme(pref) === 'dark' ? Moon : Sun;

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={label}
      title={label}
      className={`inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg border border-line bg-panel text-ink ${compact ? 'size-7' : 'size-11'}`}
    >
      <Icon size={18} aria-hidden />
    </button>
  );
}
