import { useState } from "react";
import { TEXT_SIZES, type TextSize, getTextSize, applyTextSize } from "../lib/textSize";

const PREVIEW: Record<TextSize, string> = { sm: "0.85rem", default: "1rem", lg: "1.2rem", xl: "1.4rem" };

/** Text-size chooser for the console. Lives in Profile → Appearance. Applies
 *  immediately (live) and persists; the choice is re-applied on every load. */
export function TextSizeSetting() {
  const [size, setSize] = useState<TextSize>(getTextSize);

  function choose(s: TextSize) {
    setSize(s);
    applyTextSize(s); // live + persisted
  }

  return (
    <div className="p-6 rounded-2xl border" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
      <h3 className="text-base font-bold mb-1">Text size</h3>
      <p className="text-sm mb-4" style={{ color: "var(--muted)" }}>
        Make text across the studio larger or smaller. Applies everywhere and is remembered.
      </p>
      <div role="group" aria-label="Text size" className="flex flex-wrap gap-2">
        {TEXT_SIZES.map((t) => {
          const active = size === t.value;
          return (
            <button
              key={t.value}
              onClick={() => choose(t.value)}
              aria-pressed={active}
              className="flex flex-col items-center justify-center gap-1 rounded-xl px-4 py-3"
              style={{
                minWidth: 76,
                cursor: "pointer",
                border: active ? "2px solid var(--accent)" : "1px solid var(--border)",
                background: active ? "rgba(16,185,129,0.10)" : "var(--bg)",
                color: "var(--ink)",
                fontFamily: "inherit",
              }}
            >
              <span aria-hidden style={{ fontSize: PREVIEW[t.value], fontWeight: 700, lineHeight: 1 }}>A</span>
              <span className="text-xs font-semibold" style={{ color: active ? "var(--ink)" : "var(--muted)" }}>{t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
