import { useState } from 'react';
import { applyTheme, getThemePref, THEME_PREFS, type ThemePref } from '../lib/theme';

/** Theme chooser for the console. Lives in Profile → Appearance next to the text size.
 *  Applies immediately and persists under the shared `stores-theme` key. */
export function ThemeSetting() {
  const [pref, setPref] = useState<ThemePref>(getThemePref);

  function choose(next: ThemePref) {
    setPref(next);
    applyTheme(next); // live + persisted
  }

  return (
    <div className="p-6 rounded-2xl border border-line bg-panel">
      <h3 className="text-base font-bold mb-1">Theme</h3>
      <p className="text-sm mb-4 text-muted">
        Light, dark, or follow your device. Remembered across the FreeGameStore sites.
      </p>
      {/* biome-ignore lint/a11y/useSemanticElements: a toggle-button group, not a form; <fieldset>'s min-inline-size: min-content would stop the flex-wrap. */}
      <div role="group" aria-label="Theme" className="flex flex-wrap gap-2">
        {THEME_PREFS.map((t) => {
          const active = pref === t.value;
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => choose(t.value)}
              aria-pressed={active}
              className={`min-w-[76px] cursor-pointer rounded-xl px-4 py-3 text-sm font-semibold text-ink ${
                active ? 'border-2 border-accent bg-accent-soft' : 'border border-line bg-paper'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
