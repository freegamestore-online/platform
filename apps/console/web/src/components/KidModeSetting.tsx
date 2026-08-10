import { useState } from "react";
import { KID_AGES, KID_VIBES, type KidMode, getKidMode, setKidMode } from "../lib/kidMode";

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

  const chip = (active: boolean): React.CSSProperties => ({
    cursor: "pointer",
    borderRadius: "0.75rem",
    padding: "0.5rem 0.9rem",
    fontFamily: "inherit",
    fontSize: "0.85rem",
    fontWeight: 600,
    border: active ? "2px solid var(--accent)" : "1px solid var(--border)",
    background: active ? "rgba(16,185,129,0.10)" : "var(--bg)",
    color: active ? "var(--ink)" : "var(--muted)",
  });

  return (
    <div className="p-6 rounded-2xl border" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
      <div className="flex items-start justify-between gap-4 mb-1">
        <div>
          <h3 className="text-base font-bold mb-1">Kid mode</h3>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
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
          className="shrink-0"
          style={{
            width: 46,
            height: 28,
            borderRadius: 999,
            border: "none",
            cursor: "pointer",
            padding: 3,
            background: mode.enabled ? "var(--accent)" : "var(--border)",
            transition: "background 0.15s",
          }}
        >
          <span
            style={{
              display: "block",
              width: 22,
              height: 22,
              borderRadius: "50%",
              background: "#fff",
              transform: mode.enabled ? "translateX(18px)" : "translateX(0)",
              transition: "transform 0.15s",
            }}
          />
        </button>
      </div>

      {mode.enabled && (
        <div className="mt-5 flex flex-col gap-4">
          <div>
            <p className="text-xs font-semibold mb-2" style={{ color: "var(--muted)" }}>AGE</p>
            <div role="group" aria-label="Age" className="flex flex-wrap gap-2">
              {KID_AGES.map((a) => (
                <button key={a.value} onClick={() => update({ age: a.value })} aria-pressed={mode.age === a.value} style={chip(mode.age === a.value)}>
                  {a.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold mb-2" style={{ color: "var(--muted)" }}>VIBE</p>
            <div role="group" aria-label="Vibe" className="flex flex-wrap gap-2">
              {KID_VIBES.map((v) => (
                <button key={v.value} onClick={() => update({ vibe: v.value })} aria-pressed={mode.vibe === v.value} style={chip(mode.vibe === v.value)}>
                  <span aria-hidden style={{ marginRight: 6 }}>{v.emoji}</span>{v.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
