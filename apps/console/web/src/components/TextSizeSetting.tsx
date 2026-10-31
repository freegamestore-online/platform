import { useState } from 'react';
import { applyTextSize, getTextSize, TEXT_SIZES, type TextSize } from '../lib/textSize';

const PREVIEW: Record<TextSize, string> = {
  sm: 'text-[0.85rem]',
  default: 'text-[1rem]',
  lg: 'text-[1.2rem]',
  xl: 'text-[1.4rem]',
};

/** Text-size chooser for the console. Lives in Profile → Appearance. Applies
 *  immediately (live) and persists; the choice is re-applied on every load. */
export function TextSizeSetting() {
  const [size, setSize] = useState<TextSize>(getTextSize);

  function choose(s: TextSize) {
    setSize(s);
    applyTextSize(s); // live + persisted
  }

  return (
    <div className="p-6 rounded-2xl border border-line bg-panel">
      <h3 className="text-base font-bold mb-1">Text size</h3>
      <p className="text-sm mb-4 text-muted">
        Make text across the studio larger or smaller. Applies everywhere and is remembered.
      </p>
      {/* biome-ignore lint/a11y/useSemanticElements: a toggle-button group, not a form; <fieldset>'s min-inline-size: min-content would stop the flex-wrap. */}
      <div role="group" aria-label="Text size" className="flex flex-wrap gap-2">
        {TEXT_SIZES.map((t) => {
          const active = size === t.value;
          return (
            <button
              key={t.value}
              onClick={() => choose(t.value)}
              aria-pressed={active}
              className={`flex min-w-[76px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl px-4 py-3 text-ink ${
                active ? 'border-2 border-accent bg-accent/10' : 'border border-line bg-paper'
              }`}
            >
              <span aria-hidden className={`font-bold leading-none ${PREVIEW[t.value]}`}>
                A
              </span>
              <span className={`text-xs font-semibold ${active ? 'text-ink' : 'text-muted'}`}>
                {t.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
