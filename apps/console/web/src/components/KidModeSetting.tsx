import { useState } from 'react';
import { getKidMode, KID_AGES, KID_VIBES, type KidMode, setKidMode } from '../lib/kidMode';

const CHIP_BASE = 'cursor-pointer rounded-xl px-[0.9rem] py-2 text-[0.85rem] font-semibold';
const CHIP_ACTIVE = `${CHIP_BASE} border-2 border-accent bg-accent/10 text-ink`;
const CHIP_IDLE = `${CHIP_BASE} border border-line bg-paper text-muted`;

/** Kid mode chooser — lives in Profile. When on, the agent's replies in the
 *  studio are shown rewritten for a kid (funny, simple), with a tap to reveal
 *  the original technical message. Age band + vibe tune the rewrite. Persisted
 *  in localStorage; picked up when the studio next loads. */
export function KidModeSetting() {
  const [mode, setMode] = useState<KidMode>(getKidMode);

  function update(patch: Partial<KidMode>) {
    const next = { ...mode, ...patch };
    setMode(next);
    setKidMode(next); // persisted; the studio reads it on load
  }

  const chip = (active: boolean): string => (active ? CHIP_ACTIVE : CHIP_IDLE);

  return (
    <div className="p-6 rounded-2xl border border-line bg-panel">
      <div className="flex items-start justify-between gap-4 mb-1">
        <div>
          <h3 className="text-base font-bold mb-1">Kid mode</h3>
          <p className="text-sm text-muted">
            Show the AI's replies rewritten for a kid — funny and simple. Tap any reply to see the
            original techy version.
          </p>
        </div>
        {/* Toggle switch */}
        <button
          role="switch"
          aria-checked={mode.enabled}
          aria-label="Enable kid mode"
          onClick={() => update({ enabled: !mode.enabled })}
          className={`h-7 w-[46px] shrink-0 cursor-pointer rounded-full border-0 p-[3px] transition-colors duration-150 ${
            mode.enabled ? 'bg-accent' : 'bg-line'
          }`}
        >
          <span
            className={`block size-[22px] rounded-full bg-white transition-transform duration-150 ${
              mode.enabled ? 'translate-x-[18px]' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {mode.enabled && (
        <div className="mt-5 flex flex-col gap-4">
          <div>
            <p className="text-xs font-semibold mb-2 text-muted">AGE</p>
            {/* biome-ignore lint/a11y/useSemanticElements: a toggle-button group, not a form; <fieldset>'s min-inline-size: min-content would stop the flex-wrap. */}
            <div role="group" aria-label="Age" className="flex flex-wrap gap-2">
              {KID_AGES.map((a) => (
                <button
                  key={a.value}
                  onClick={() => update({ age: a.value })}
                  aria-pressed={mode.age === a.value}
                  className={chip(mode.age === a.value)}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold mb-2 text-muted">VIBE</p>
            {/* biome-ignore lint/a11y/useSemanticElements: a toggle-button group, not a form; <fieldset>'s min-inline-size: min-content would stop the flex-wrap. */}
            <div role="group" aria-label="Vibe" className="flex flex-wrap gap-2">
              {KID_VIBES.map((v) => (
                <button
                  key={v.value}
                  onClick={() => update({ vibe: v.value })}
                  aria-pressed={mode.vibe === v.value}
                  className={chip(mode.vibe === v.value)}
                >
                  <span aria-hidden className="mr-1.5">
                    {v.emoji}
                  </span>
                  {v.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
